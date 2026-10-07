"""Invite and view links, roles, and free/busy privacy."""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from conftest import sign_in
from sqlalchemy import select

from vacation_optimizer import orm
from vacation_optimizer.api import app
from vacation_optimizer.db import get_session

OCTOBER = {"start": "2026-10-01", "end": "2026-10-31"}


def me_adult(client, name, pto):
    response = client.post("/people", json={"name": name, "kind": "ADULT", "pto_balance": pto, "is_self": True})
    assert response.status_code == 201, response.text
    person_id = response.json()["id"]
    client.post(f"/people/{person_id}/calendars", json={"calendar_id": 1})
    return person_id


def owner_with_group(client):
    """Pat (10 PTO) owns a group. Returns (pat_id, group_id)."""
    pat = me_adult(client, "Pat Smith", 10)
    group = client.post("/groups", json={"name": "Smith + Lee trip", "person_ids": [pat]}).json()
    return pat, group["id"]


def make_link(client, group_id, kind):
    response = client.post(f"/groups/{group_id}/links", json={"kind": kind})
    assert response.status_code == 201, response.text
    return response.json()


def db(client):
    return app.dependency_overrides[get_session]()


def test_invite_join_and_plan_together(client):
    _, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")

    sign_in(client, "lee@example.com")
    assert client.get(f"/links/{invite['token']}").json() == {
        "group_name": "Smith + Lee trip", "invited_by": "Pat", "kind": "INVITE",  # from "Pat Smith"
    }
    lee = me_adult(client, "Lee Jones", 1)
    joined = client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})
    assert joined.json() == {"id": group_id, "name": "Smith + Lee trip", "role": "MEMBER"}
    assert client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]}).status_code == 200  # twice is fine

    # Lee's 1 PTO day is the bottleneck: the Columbus Day break costs each of them 1.
    windows = client.get(f"/groups/{group_id}/windows", params=OCTOBER).json()["windows"]
    assert windows[0]["pto_cost"] == {"Pat Smith": 1, "Lee Jones": 1}
    assert all(max(w["pto_cost"].values()) <= 1 for w in windows)


def test_other_families_see_names_not_balances(client):
    pat, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 3)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})

    as_lee = {p["id"]: p for p in client.get(f"/groups/{group_id}").json()["people"]}
    assert as_lee[lee]["pto_balance"] == 3 and as_lee[lee]["mine"]
    assert as_lee[pat] == {"id": pat, "name": "Pat Smith", "kind": "ADULT", "mine": False,
                           "pto_balance": None, "work_week": None}

    sign_in(client, "parent@example.com")
    as_pat = {p["id"]: p for p in client.get(f"/groups/{group_id}").json()["people"]}
    assert as_pat[lee]["pto_balance"] is None


def test_members_have_limited_powers(client):
    pat, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 3)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})

    assert client.post(f"/groups/{group_id}/links", json={"kind": "VIEW"}).status_code == 403
    assert client.get(f"/groups/{group_id}/links").status_code == 403
    assert client.delete(f"/groups/{group_id}/members/{pat}").status_code == 403
    assert client.delete(f"/groups/{group_id}/members/{lee}").status_code == 204  # leaving is allowed
    assert client.get(f"/groups/{group_id}").status_code == 404  # and then it's gone for Lee


def test_owner_can_remove_anyone(client):
    pat, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 3)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})

    sign_in(client, "parent@example.com")
    assert client.delete(f"/groups/{group_id}/members/{lee}").status_code == 204
    assert [p["id"] for p in client.get(f"/groups/{group_id}").json()["people"]] == [pat]


def test_cannot_bring_someone_elses_person(client):
    pat, group_id = owner_with_group(client)
    invite = make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    assert client.post(f"/links/{invite['token']}/accept", json={"person_ids": [pat]}).status_code == 404


def test_revoked_and_expired_links_stop_working(client):
    _, group_id = owner_with_group(client)
    revoked, expired = make_link(client, group_id, "INVITE"), make_link(client, group_id, "VIEW")
    assert client.delete(f"/groups/{group_id}/links/{revoked['id']}").status_code == 204
    db(client).get(orm.ShareLink, expired["id"]).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db(client).flush()

    listed = {link["id"]: link["revoked"] for link in client.get(f"/groups/{group_id}/links").json()}
    assert listed == {revoked["id"]: True, expired["id"]: False}
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee", 3)
    for link in (revoked, expired):
        assert client.get(f"/links/{link['token']}").status_code == 404
    assert client.post(f"/links/{revoked['token']}/accept", json={"person_ids": [lee]}).status_code == 404
    assert client.get(f"/links/{expired['token']}/view", params=OCTOBER).status_code == 404


def test_links_expire_in_90_days(client):
    _, group_id = owner_with_group(client)
    link = make_link(client, group_id, "INVITE")
    lifetime = datetime.fromisoformat(link["expires_at"]) - datetime.now(UTC)
    assert timedelta(days=89, hours=23) < lifetime <= timedelta(days=90)


def test_view_link_needs_no_account_and_shows_first_names_only(client):
    _, group_id = owner_with_group(client)
    view = make_link(client, group_id, "VIEW")
    del client.headers["Authorization"]

    response = client.get(f"/links/{view['token']}/view", params=OCTOBER)
    assert response.status_code == 200
    body = response.json()
    assert body["group_name"] == "Smith + Lee trip"
    assert body["people"] == ["Pat"]
    assert body["search"]["windows"][0]["pto_cost"] == {"Pat": 1}
    text = json.dumps(body)
    assert "Smith" not in text.replace("Smith + Lee trip", "") and "pto_balance" not in text


def test_link_kinds_cannot_be_swapped(client):
    _, group_id = owner_with_group(client)
    view, invite = make_link(client, group_id, "VIEW"), make_link(client, group_id, "INVITE")
    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee", 3)
    assert client.post(f"/links/{view['token']}/accept", json={"person_ids": [lee]}).status_code == 404
    assert client.get(f"/links/{invite['token']}/view", params=OCTOBER).status_code == 404


def test_only_a_hash_of_the_token_is_stored(client):
    _, group_id = owner_with_group(client)
    link = make_link(client, group_id, "INVITE")
    stored = db(client).scalars(select(orm.ShareLink.token_hash).where(orm.ShareLink.id == link["id"])).one()
    assert stored != link["token"]
    assert stored == hashlib.sha256(link["token"].encode()).hexdigest()
    assert len(link["token"]) >= 43  # 32 random bytes, base64url


def test_stranger_cannot_manage_links(client):
    _, group_id = owner_with_group(client)
    link = make_link(client, group_id, "INVITE")
    sign_in(client, "stranger@example.com")
    assert client.post(f"/groups/{group_id}/links", json={"kind": "INVITE"}).status_code == 404
    assert client.delete(f"/groups/{group_id}/links/{link['id']}").status_code == 404
