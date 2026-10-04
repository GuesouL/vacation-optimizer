"""API tests against a real Postgres database.

Each test runs inside a transaction that's rolled back afterward, so tests
can't leak data into each other and the database never needs cleaning.
Needs the test database migrated first: see the README.
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from vacation_optimizer.api import app
from vacation_optimizer.db import get_session

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://vacation:vacation@localhost:5432/vacation_test"
)
FEDERAL_CALENDAR_ID = 1  # seeded by the first migration


@pytest.fixture(scope="module")
def db_engine():
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def client(db_engine):
    with db_engine.connect() as connection:
        transaction = connection.begin()
        # Every commit() inside the app becomes a savepoint inside our transaction.
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        app.dependency_overrides[get_session] = lambda: session
        yield TestClient(app)
        app.dependency_overrides.clear()
        session.close()
        transaction.rollback()


def adult(client, name, pto, **extra):
    person = client.post("/people", json={"name": name, "kind": "ADULT", "pto_balance": pto, **extra})
    assert person.status_code == 201, person.text
    person_id = person.json()["id"]
    subscribed = client.post(f"/people/{person_id}/calendars", json={"calendar_id": FEDERAL_CALENDAR_ID})
    assert subscribed.status_code == 204
    return person_id


def group(client, *person_ids):
    response = client.post("/groups", json={"name": "Trip", "person_ids": list(person_ids)})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def windows(client, group_id, **params):
    query = {"start": "2026-09-10", "end": "2027-06-28", **params}
    response = client.get(f"/groups/{group_id}/windows", params=query)
    assert response.status_code == 200, response.text
    return response.json()


def find(items, start, end):
    return next((w for w in items if (w["start"], w["end"]) == (start, end)), None)


def test_federal_calendar_is_seeded(client):
    calendars = client.get("/calendars").json()
    assert {"id": 1, "name": "US Federal Holidays", "kind": "FEDERAL"} in calendars


def test_bottleneck_through_the_api(client):
    """Edge case 3, end to end: rows in Postgres -> engine -> JSON."""
    group_id = group(client, adult(client, "Alice", 10), adult(client, "Bob", 5))
    result = windows(client, group_id, sort="longest")

    longest = result["windows"][0]
    assert (longest["start"], longest["end"]) == ("2026-12-24", "2027-01-03")
    assert longest["pto_cost"] == {"Alice": 5, "Bob": 5}


def test_school_calendar_and_kid(client):
    parent = adult(client, "Parent", 10)
    kid = client.post("/people", json={"name": "Kid", "kind": "CHILD"}).json()["id"]
    school = client.post("/calendars", json={"name": "NYC Schools", "kind": "SCHOOL"}).json()["id"]
    client.post(f"/calendars/{school}/events", json={
        "title": "Thanksgiving Recess", "start_date": "2026-11-26",
        "end_date": "2026-11-27", "effect": "DAY_OFF",
    })
    client.post(f"/people/{kid}/calendars", json={"calendar_id": school})

    result = windows(client, group(client, parent, kid), start="2026-11-01", end="2026-11-30")
    thanksgiving = find(result["windows"], "2026-11-26", "2026-11-29")
    assert thanksgiving["pto_cost"] == {"Parent": 1, "Kid": 0}
    assert thanksgiving["score"] == 4.0


def test_excluded_holidays_and_committed_pto(client):
    """Edge cases 9 and 10: per-person exceptions survive the trip through the database."""
    alice = adult(client, "Alice", 10)
    bob = adult(client, "Bob", 10)
    client.post(f"/people/{bob}/calendars", json={
        "calendar_id": FEDERAL_CALENDAR_ID, "excluded_titles": ["Columbus Day"],
    })
    client.post(f"/people/{alice}/pto-blocks", json={
        "start_date": "2026-12-28", "end_date": "2026-12-31", "status": "COMMITTED",
    })
    # A PROPOSED block is just an idea and must not change anything.
    client.post(f"/people/{bob}/pto-blocks", json={
        "start_date": "2026-12-28", "end_date": "2026-12-31", "status": "PROPOSED",
    })
    result = windows(client, group(client, alice, bob), limit=200)

    assert find(result["windows"], "2026-10-10", "2026-10-12")["pto_cost"] == {"Alice": 0, "Bob": 1}
    # Starts on Christmas, not Dec 26: Dec 25 is free for both, so the engine grows the window.
    new_year = find(result["windows"], "2026-12-25", "2027-01-03")
    assert new_year["pto_cost"] == {"Alice": 0, "Bob": 4}


def test_free_long_weekends_have_no_score(client):
    result = windows(client, group(client, adult(client, "Broke", 0)))
    assert result["windows"] == []
    columbus = find(result["free_long_weekends"], "2026-10-10", "2026-10-12")
    assert columbus["score"] is None  # no divide by zero


def test_duplicate_names_get_ids(client):
    first, second = adult(client, "Sam", 5), adult(client, "Sam", 5)
    result = windows(client, group(client, first, second))
    assert set(result["windows"][0]["pto_cost"]) == {f"Sam (#{first})", f"Sam (#{second})"}


@pytest.mark.parametrize("body, problem", [
    ({"name": "A", "kind": "ADULT"}, "adults need a pto_balance"),
    ({"name": "K", "kind": "CHILD", "pto_balance": 3}, "children don't have a pto_balance"),
    ({"name": "A", "kind": "ADULT", "pto_balance": -1}, "greater than or equal to 0"),
    ({"name": "A", "kind": "ADULT", "pto_balance": 5, "work_week": [7]}, "0 (Mon) through 6"),
])
def test_bad_people_are_rejected(client, body, problem):
    response = client.post("/people", json=body)
    assert response.status_code == 422
    assert problem in response.text


def test_limit_caps_results(client):
    result = windows(client, group(client, adult(client, "Alice", 10)), limit=3)
    assert len(result["windows"]) == 3


def test_cannot_create_a_second_federal_calendar(client):
    response = client.post("/calendars", json={"name": "Fake", "kind": "FEDERAL"})
    assert response.status_code == 422


def test_bad_searches_are_rejected(client):
    group_id = group(client, adult(client, "Alice", 10))
    url = f"/groups/{group_id}/windows"
    assert client.get(url, params={"start": "2027-01-01", "end": "2026-01-01"}).status_code == 422
    assert client.get(url, params={"start": "2026-01-01", "end": "2028-01-01"}).status_code == 422
    assert client.get("/groups/999999/windows", params={"start": "2026-01-01", "end": "2026-02-01"}).status_code == 404


def test_cannot_add_events_to_federal_calendar(client):
    response = client.post(f"/calendars/{FEDERAL_CALENDAR_ID}/events", json={
        "title": "Fake", "start_date": "2026-01-02", "end_date": "2026-01-02", "effect": "DAY_OFF",
    })
    assert response.status_code == 400


def test_bad_event_dates_are_rejected(client):
    calendar = client.post("/calendars", json={"name": "Work", "kind": "WORK"}).json()["id"]
    response = client.post(f"/calendars/{calendar}/events", json={
        "title": "Backwards", "start_date": "2026-05-02", "end_date": "2026-05-01", "effect": "BUSY",
    })
    assert response.status_code == 422
