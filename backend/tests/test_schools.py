"""Kids follow their school district's calendar (seeded: NYC Public Schools 2026-27)."""

from conftest import sign_in
from test_api import adult, find, group, windows


def nyc_id(client):
    schools = client.get("/calendars", params={"kind": "SCHOOL"}).json()
    return next(c["id"] for c in schools if c["name"] == "NYC Public Schools 2026-27")


def kid(client, name, calendar_id):
    kid_id = client.post("/people", json={"name": name, "kind": "CHILD"}).json()["id"]
    assert client.post(f"/people/{kid_id}/calendars", json={"calendar_id": calendar_id}).status_code == 204
    return kid_id


def test_school_districts_are_listed_by_kind(client):
    schools = client.get("/calendars", params={"kind": "SCHOOL"}).json()
    assert "NYC Public Schools 2026-27" in [c["name"] for c in schools]
    assert all(c["kind"] == "SCHOOL" for c in schools)


def test_a_kid_in_school_shapes_the_trip(client):
    parent = adult(client, "Parent", 10)
    group_id = group(client, parent, kid(client, "Kid", nyc_id(client)))
    result = windows(client, group_id, limit=200, distinct=False)

    # Columbus Day: the kid has school Fri Oct 9, so only Sat-Mon works, and it's free.
    assert find(result["windows"], "2026-10-09", "2026-10-12") is None
    assert find(result["free_long_weekends"], "2026-10-10", "2026-10-12")
    # Thanksgiving: school is out Thu-Fri; the parent spends 1 day on Friday.
    thanksgiving = find(result["windows"], "2026-11-26", "2026-11-29")
    assert thanksgiving["pto_cost"] == {"Parent": 1, "Kid": 0}
    # Mon-Wed before Thanksgiving are school days, so this longer trip is out.
    assert find(result["windows"], "2026-11-21", "2026-11-29") is None
    # Spring Recess, Thu Apr 22 - Fri Apr 30, plus the weekend after.
    spring = find(result["windows"], "2027-04-22", "2027-05-02")
    assert spring["pto_cost"] == {"Parent": 7, "Kid": 0}


def test_kids_never_spend_pto(client):
    parent = adult(client, "Parent", 10)
    result = windows(client, group(client, parent, kid(client, "Kid", nyc_id(client))), limit=200, distinct=False)
    assert all(w["pto_cost"]["Kid"] == 0 for w in result["windows"] + result["free_long_weekends"])


def test_add_my_kid_to_an_existing_group(client):
    parent = adult(client, "Parent", 10)
    group_id = group(client, parent)
    kid_id = kid(client, "Kid", nyc_id(client))

    added = client.post(f"/groups/{group_id}/members", json={"person_ids": [kid_id, kid_id]})
    assert added.status_code == 200
    assert [p["name"] for p in added.json()["people"]] == ["Parent", "Kid"]

    sign_in(client, "stranger@example.com")
    stranger_kid = client.post("/people", json={"name": "Other", "kind": "CHILD"}).json()["id"]
    assert client.post(f"/groups/{group_id}/members", json={"person_ids": [stranger_kid]}).status_code == 404


def test_cannot_add_someone_elses_person_to_my_group(client):
    sign_in(client, "stranger@example.com")
    theirs = client.post("/people", json={"name": "Other", "kind": "CHILD"}).json()["id"]
    sign_in(client, "parent@example.com")
    group_id = group(client, adult(client, "Parent", 10))
    assert client.post(f"/groups/{group_id}/members", json={"person_ids": [theirs]}).status_code == 404
