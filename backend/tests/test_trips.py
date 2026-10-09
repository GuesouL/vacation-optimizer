"""Saved group trips and booking PTO for them."""

from datetime import date

import pytest
from conftest import YEAR_START, sign_in
from sqlalchemy import select
from test_sharing import db, make_link, me_adult, owner_with_group

from vacation_optimizer import orm, trips
from vacation_optimizer.api import app
from vacation_optimizer.engine import booking_cost

# Mon Dec 28 - Thu Dec 31, 2026: four workdays, no holidays.
NEW_YEAR_WEEK = {"start_date": "2026-12-28", "end_date": "2026-12-31"}


@pytest.fixture(autouse=True)
def pinned_today(client):
    """Every test runs on the first day of the test planning year, whatever the real date is."""
    app.dependency_overrides[trips.today] = lambda: YEAR_START


def save(client, group_id, **body):
    response = client.post(f"/groups/{group_id}/trips", json={**NEW_YEAR_WEEK, **body})
    assert response.status_code == 201, response.text
    return response.json()


def book(client, group_id, trip_id):
    return client.post(f"/groups/{group_id}/trips/{trip_id}/booking")


def bookings(client, trip_id):
    return db(client).scalars(select(orm.PTOBlock).where(orm.PTOBlock.trip_id == trip_id)).all()


def test_save_then_book(client):
    pat, group_id = owner_with_group(client)
    trip = save(client, group_id, label="New Year's")
    assert trip | {"id": 0} == {
        "id": 0, "start_date": "2026-12-28", "end_date": "2026-12-31", "label": "New Year's",
        "booked_by": [], "can_book": True, "mine_booked": False, "can_delete": True,
    }
    assert bookings(client, trip["id"]) == []  # saving alone spends nobody's PTO

    booked = book(client, group_id, trip["id"])
    assert booked.status_code == 200, booked.text
    assert booked.json()["booked_by"] == ["Pat Smith"]
    assert booked.json()["mine_booked"] is True
    [block] = bookings(client, trip["id"])
    assert (block.person_id, block.status) == (pat, orm.PTOStatus.COMMITTED)

    # The plan now sees those days as already off, so they cost nothing more.
    plan = client.get(f"/groups/{group_id}/windows", params={
        "start": "2026-12-26", "end": "2027-01-03", "distinct": "false", "limit": 200,
    }).json()
    week = next(w for w in plan["windows"] + plan["free_long_weekends"]
                if (w["start"], w["end"]) == ("2026-12-26", "2027-01-03"))
    assert week["pto_cost"] == {"Pat Smith": 0}

    assert client.get(f"/groups/{group_id}/trips").json() == [booked.json()]
    assert book(client, group_id, trip["id"]).status_code == 200  # twice is fine


def test_booking_is_all_or_nothing(client):
    _, group_id = owner_with_group(client)  # Pat has 10 days
    partner = client.post("/people", json={"name": "Sam Smith", "kind": "ADULT", "pto_balance": 3}).json()["id"]
    client.post(f"/people/{partner}/calendars", json={"calendar_id": 1})
    client.post(f"/groups/{group_id}/members", json={"person_ids": [partner]})
    trip = save(client, group_id)

    response = book(client, group_id, trip["id"])
    assert response.status_code == 409
    assert response.json()["detail"] == "Sam Smith doesn't have enough PTO left for this trip"
    assert bookings(client, trip["id"]) == []  # not even Pat's share was saved


def test_no_double_booking(client):
    pat, group_id = owner_with_group(client)
    client.post(f"/people/{pat}/pto-blocks", json={
        "start_date": "2026-12-30", "end_date": "2027-01-04", "status": "COMMITTED",
    })
    trip = save(client, group_id)
    response = book(client, group_id, trip["id"])
    assert response.status_code == 409
    assert response.json()["detail"] == "Pat Smith already has PTO booked 2026-12-30 to 2027-01-04"


def test_database_refuses_overlapping_pto(client):
    """The exclusion constraint is the backstop: even a request that skips the
    friendly check can't double-book. Ideas (PROPOSED) may overlap."""
    pat, _ = owner_with_group(client)
    first = {**NEW_YEAR_WEEK, "status": "COMMITTED"}
    assert client.post(f"/people/{pat}/pto-blocks", json=first).status_code == 201
    overlap = {"start_date": "2026-12-31", "end_date": "2027-01-02"}
    assert client.post(f"/people/{pat}/pto-blocks", json={**overlap, "status": "PROPOSED"}).status_code == 201
    response = client.post(f"/people/{pat}/pto-blocks", json={**overlap, "status": "COMMITTED"})
    assert response.status_code == 409
    # Touching end to end isn't overlapping: Dec 31 then Jan 1.
    after = {"start_date": "2027-01-01", "end_date": "2027-01-01", "status": "COMMITTED"}
    assert client.post(f"/people/{pat}/pto-blocks", json=after).status_code == 201


def test_cancel_booking_keeps_the_trip(client):
    _, group_id = owner_with_group(client)
    trip = save(client, group_id)
    book(client, group_id, trip["id"])
    response = client.delete(f"/groups/{group_id}/trips/{trip['id']}/booking")
    assert response.json()["booked_by"] == []
    assert bookings(client, trip["id"]) == []
    assert len(client.get(f"/groups/{group_id}/trips").json()) == 1


def test_two_families_book_their_own_share(client):
    _, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    trip = save(client, group_id)
    book(client, group_id, trip["id"])

    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 10)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})
    [seen] = client.get(f"/groups/{group_id}/trips").json()
    assert (seen["booked_by"], seen["mine_booked"], seen["can_delete"]) == (["Pat Smith"], False, False)

    # Lee books only Lee. Cancelling only takes back Lee's share.
    assert book(client, group_id, trip["id"]).json()["booked_by"] == ["Pat Smith", "Lee Jones"]
    assert client.delete(f"/groups/{group_id}/trips/{trip['id']}/booking").json()["booked_by"] == ["Pat Smith"]
    assert client.delete(f"/groups/{group_id}/trips/{trip['id']}").status_code == 403

    # The owner can delete it; everyone's bookings go with it.
    sign_in(client, "parent@example.com")
    assert client.delete(f"/groups/{group_id}/trips/{trip['id']}").status_code == 204
    assert bookings(client, trip["id"]) == []
    assert client.get(f"/groups/{group_id}/trips").json() == []


def test_bad_trips_are_rejected(client):
    _, group_id = owner_with_group(client)
    started = client.post(f"/groups/{group_id}/trips", json={"start_date": "2026-09-09", "end_date": "2026-09-12"})
    assert started.status_code == 422
    too_long = client.post(f"/groups/{group_id}/trips", json={"start_date": "2026-12-01", "end_date": "2027-01-01"})
    assert too_long.status_code == 422
    backwards = client.post(f"/groups/{group_id}/trips", json={"start_date": "2026-12-31", "end_date": "2026-12-28"})
    assert backwards.status_code == 422
    save(client, group_id)
    assert client.post(f"/groups/{group_id}/trips", json=NEW_YEAR_WEEK).status_code == 409  # same dates twice

    sign_in(client, "stranger@example.com")
    assert client.get(f"/groups/{group_id}/trips").status_code == 404
    assert client.post(f"/groups/{group_id}/trips", json=NEW_YEAR_WEEK).status_code == 404


def test_booking_cost_matches_the_search(make_adult):
    """Holidays are free, and a trip that crosses a renewal is paid from both years."""
    pat = make_adult("Pat", 10)
    # Thu Dec 24 + Mon-Thu Dec 28-31. Christmas (Fri) and the weekend are free.
    assert booking_cost(pat, YEAR_START, date(2026, 12, 24), date(2026, 12, 31)) == 5
    assert booking_cost(make_adult("Low", 3), YEAR_START, date(2026, 12, 28), date(2026, 12, 31)) is None
    # 1 day left this year, 10 fresh on Jan 1: Dec 31 + Jan 4-5 costs 1 + 2.
    renews = make_adult("Renews", 1, pto_allowance=10)
    assert booking_cost(renews, YEAR_START, date(2026, 12, 31), date(2027, 1, 5)) == 3
    with pytest.raises(ValueError):
        booking_cost(pat, YEAR_START, date(2026, 9, 1), date(2026, 9, 3))
