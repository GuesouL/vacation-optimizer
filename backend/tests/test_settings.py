"""Editing a person after setup, and the PTO-left number on the plan header."""

import pytest
from conftest import YEAR_START, sign_in
from test_sharing import make_link, me_adult, owner_with_group

from vacation_optimizer import trips
from vacation_optimizer.api import app

NEW_YEAR_WEEK = {"start_date": "2026-12-28", "end_date": "2026-12-31"}  # Mon-Thu, no holidays


@pytest.fixture(autouse=True)
def pinned_today(client):
    app.dependency_overrides[trips.today] = lambda: YEAR_START


def person(client, person_id):
    return next(p for p in client.get("/me").json()["people"] if p["id"] == person_id)


def pto_left(client, group_id, person_id):
    people = client.get(f"/groups/{group_id}").json()["people"]
    return next(p for p in people if p["id"] == person_id)["pto_left"]


def test_edit_replaces_the_old_values(client):
    pat = me_adult(client, "Pat Smith", 10)
    update = {
        "name": "  Patricia Smith ", "pto_balance": 4, "work_week": [0, 1, 2, 3],
        "pto_allowance": 20, "pto_renews_on": {"month": 3, "day": 15}, "pto_carryover_max": 5,
    }
    response = client.put(f"/people/{pat}", json=update)
    assert response.status_code == 200, response.text
    assert person(client, pat) == response.json() == {
        "id": pat, "name": "Patricia Smith", "kind": "ADULT", "pto_balance": 4, "work_week": [0, 1, 2, 3],
        "pto_allowance": 20, "pto_renews_on": {"month": 3, "day": 15}, "pto_carryover_max": 5,
    }

    # Leaving the renewal out clears it, so "I no longer have a renewal date" is possible.
    cleared = client.put(f"/people/{pat}", json={"name": "Pat", "pto_balance": 4}).json()
    assert (cleared["pto_allowance"], cleared["pto_renews_on"], cleared["pto_carryover_max"]) == (None, None, None)
    assert cleared["work_week"] == [0, 1, 2, 3, 4]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"pto_balance": None}, "adults need a pto_balance"),
        ({"pto_balance": -1}, "greater than or equal to 0"),
        ({"work_week": [7]}, "0 (Mon) through 6"),
        ({"pto_renews_on": {"month": 2, "day": 30}}, "isn't a real date"),
        ({"name": "   "}, ""),
    ],
)
def test_bad_edits_are_rejected(client, change, message):
    pat = me_adult(client, "Pat Smith", 10)
    response = client.put(f"/people/{pat}", json={"name": "Pat", "pto_balance": 10, **change})
    assert response.status_code == 422
    assert message in response.text
    assert person(client, pat)["name"] == "Pat Smith"  # nothing was saved


def test_a_kid_can_be_renamed_but_never_given_pto(client):
    kid = client.post("/people", json={"name": "Noah", "kind": "CHILD"}).json()["id"]
    assert client.put(f"/people/{kid}", json={"name": "Noah S."}).json()["name"] == "Noah S."
    response = client.put(f"/people/{kid}", json={"name": "Noah", "pto_balance": 3})
    assert response.status_code == 422
    assert "children don't have a pto_balance" in response.text


def test_you_can_only_edit_your_own_people(client):
    pat, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 3)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})

    # Lee sees Pat in the group, but Pat isn't Lee's to change.
    assert client.put(f"/people/{pat}", json={"name": "Hacked", "pto_balance": 99}).status_code == 404
    sign_in(client, "stranger@example.com")
    assert client.put(f"/people/{lee}", json={"name": "Hacked", "pto_balance": 99}).status_code == 404
    sign_in(client, "parent@example.com")
    assert person(client, pat)["name"] == "Pat Smith"


def test_pto_left_subtracts_booked_trips(client):
    pat, group_id = owner_with_group(client)  # 10 days
    assert pto_left(client, group_id, pat) == 10

    trip = client.post(f"/groups/{group_id}/trips", json=NEW_YEAR_WEEK).json()
    client.post(f"/groups/{group_id}/trips/{trip['id']}/booking")
    assert pto_left(client, group_id, pat) == 6  # four workdays booked

    # The edited balance is the new starting point; the booking still comes off it.
    client.put(f"/people/{pat}", json={"name": "Pat Smith", "pto_balance": 12})
    assert pto_left(client, group_id, pat) == 8

    client.delete(f"/groups/{group_id}/trips/{trip['id']}/booking")
    assert pto_left(client, group_id, pat) == 12


def test_pto_left_ignores_trips_already_taken_and_other_years(client):
    """The balance means "left as of today", so an earlier booking was already spent from it,
    and a booking after the renewal comes out of next year's days."""
    pat, group_id = owner_with_group(client)
    for dates in (("2026-09-01", "2026-09-04"), ("2027-01-04", "2027-01-07")):
        client.post(f"/people/{pat}/pto-blocks", json={
            "start_date": dates[0], "end_date": dates[1], "status": "COMMITTED",
        })
    assert pto_left(client, group_id, pat) == 10  # neither booking comes off today's balance
    # The January booking is counted separately, so the app can say where it came from.
    people = client.get(f"/groups/{group_id}").json()["people"]
    assert next(p for p in people if p["id"] == pat)["pto_next_year"] == 4

    client.post(f"/people/{pat}/pto-blocks", json={**NEW_YEAR_WEEK, "status": "COMMITTED"})
    assert pto_left(client, group_id, pat) == 6  # a booking before the renewal does


def test_an_organizer_manages_a_partner_who_never_signs_in(client):
    """A partner added with `is_self` false has no login. The organizer sees their PTO
    left, can edit it, and the partner still can't be reached by anyone else."""
    _, group_id = owner_with_group(client)
    sam = client.post("/people", json={"name": "Sam", "kind": "ADULT", "pto_balance": 6}).json()["id"]
    client.post(f"/people/{sam}/calendars", json={"calendar_id": 1})
    client.post(f"/groups/{group_id}/members", json={"person_ids": [sam]})

    assert pto_left(client, group_id, sam) == 6
    assert client.put(f"/people/{sam}", json={"name": "Sam", "pto_balance": 9}).status_code == 200
    assert pto_left(client, group_id, sam) == 9
    assert person(client, sam)["name"] == "Sam"  # shows up under the organizer's people

    sign_in(client, "stranger@example.com")
    assert client.put(f"/people/{sam}", json={"name": "Hacked", "pto_balance": 99}).status_code == 404
