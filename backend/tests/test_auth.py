"""Sign-in and ownership: the API only answers for the signed-in account's own data."""

import base64
import json
from datetime import timedelta

import pytest
from conftest import sign_in, token
from test_api import FEDERAL_CALENDAR_ID, adult, group


@pytest.mark.parametrize("header, reason", [
    (None, "Sign in first"),
    (f"Bearer {token(secret='a-different-secret-that-is-also-32-bytes-long')}", "Invalid token"),
    (f"Bearer {token(expires_in=timedelta(minutes=-1))}", "Your session expired"),
    (f"Bearer {token(aud='some-other-service')}", "Invalid token"),
    ("Bearer not-a-token", "Invalid token"),
])
def test_bad_or_missing_tokens_are_turned_away(client, header, reason):
    del client.headers["Authorization"]
    if header:
        client.headers["Authorization"] = header
    response = client.get("/me")
    assert response.status_code == 401
    assert response.json()["detail"] == reason


def test_unsigned_token_is_rejected(client):
    """alg "none" means "no signature". Pinning HS256 is what stops this forgery."""
    def part(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    forged = f"{part({'alg': 'none', 'typ': 'JWT'})}.{part({'email': 'parent@example.com', 'aud': 'vacation-optimizer-api', 'exp': 9999999999})}."
    client.headers["Authorization"] = f"Bearer {forged}"
    assert client.get("/me").status_code == 401


def test_public_routes_need_no_sign_in(client):
    del client.headers["Authorization"]
    assert client.get("/health").status_code == 200
    assert client.get("/holidays/2026").status_code == 200


def test_first_request_creates_the_account(client):
    sign_in(client, "New.Person@Example.com")
    me = client.get("/me").json()
    assert me == {"email": "new.person@example.com", "name": "new.person",
                  "self_person_id": None, "people": [], "groups": []}


def test_me_lists_my_people_and_groups(client):
    me_id = adult(client, "Pat", 10, is_self=True)
    kid = client.post("/people", json={"name": "Kid", "kind": "CHILD"}).json()["id"]
    group_id = group(client, me_id, kid)

    me = client.get("/me").json()
    assert me["self_person_id"] == me_id
    assert [p["id"] for p in me["people"]] == [me_id, kid]
    assert me["groups"] == [{"id": group_id, "name": "Trip", "role": "OWNER"}]


def test_only_one_self_profile(client):
    adult(client, "Pat", 10, is_self=True)
    again = client.post("/people", json={"name": "Pat", "kind": "ADULT", "pto_balance": 5, "is_self": True})
    assert again.status_code == 409


def test_another_family_cannot_see_or_use_my_things(client):
    mine = adult(client, "Pat", 10)
    my_group = group(client, mine)
    private = client.post("/calendars", json={"name": "Our league", "kind": "LEAGUE"}).json()["id"]

    sign_in(client, "stranger@example.com")
    # 404, not 403: a stranger can't even tell these ids exist.
    assert client.get(f"/groups/{my_group}").status_code == 404
    windows = client.get(f"/groups/{my_group}/windows", params={"start": "2026-10-01", "end": "2026-10-31"})
    assert windows.status_code == 404
    assert client.post("/groups", json={"name": "Hijack", "person_ids": [mine]}).status_code == 404
    pto = client.post(f"/people/{mine}/pto-blocks", json={
        "start_date": "2026-12-28", "end_date": "2026-12-31", "status": "COMMITTED",
    })
    assert pto.status_code == 404
    assert private not in [c["id"] for c in client.get("/calendars").json()]
    theirs = adult(client, "Sam", 5)
    assert client.post(f"/people/{theirs}/calendars", json={"calendar_id": private}).status_code == 404
    assert client.get("/me").json()["groups"] == []


def test_shared_calendars_are_read_only(client):
    """The federal calendar has no owner, so everyone can subscribe but nobody can edit it."""
    assert FEDERAL_CALENDAR_ID in [c["id"] for c in client.get("/calendars").json()]
    response = client.post(f"/calendars/{FEDERAL_CALENDAR_ID}/events", json={
        "title": "Fake", "start_date": "2026-01-02", "end_date": "2026-01-02", "effect": "DAY_OFF",
    })
    assert response.status_code in (400, 403)


def test_kids_cannot_be_my_own_profile(client):
    response = client.post("/people", json={"name": "Kid", "kind": "CHILD", "is_self": True})
    assert response.status_code == 422
