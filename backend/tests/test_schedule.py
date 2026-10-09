"""A person's own schedules through the API: see, add, delete, import, and what the engine does with them."""

from conftest import sign_in
from test_api import adult, find, group, windows
from test_sharing import db

from vacation_optimizer import orm

SPRING = {"title": "Spring Break", "start_date": "2027-04-05", "end_date": "2027-04-09", "effect": "DAY_OFF"}
TOURNAMENT = {"title": "Tournament", "start_date": "2027-04-07", "end_date": "2027-04-07", "effect": "BUSY"}
SEARCH = {"start": "2027-03-29", "end": "2027-04-18", "distinct": "false", "limit": 200}


def make_calendar(client, kind="SCHOOL", name="Kid's school"):
    response = client.post("/calendars", json={"name": name, "kind": kind})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def kid(client, name="Kid"):
    return client.post("/people", json={"name": name, "kind": "CHILD"}).json()["id"]


def attach(client, person_id, calendar_id):
    assert client.post(f"/people/{person_id}/calendars", json={"calendar_id": calendar_id}).status_code == 204


def ics_text(*events):
    body = "".join(f"BEGIN:VEVENT\r\nUID:{i}\r\n{e}\r\nEND:VEVENT\r\n" for i, e in enumerate(events))
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n{body}END:VCALENDAR\r\n"


def test_bulk_add_list_and_delete(client):
    cal = make_calendar(client)
    added = client.post(f"/calendars/{cal}/events/bulk", json={"events": [TOURNAMENT, SPRING]})
    assert added.status_code == 201, added.text
    assert [e["title"] for e in added.json()] == ["Spring Break", "Tournament"]  # by date

    listed = client.get(f"/calendars/{cal}/events").json()
    assert [e["title"] for e in listed] == ["Spring Break", "Tournament"]

    assert client.delete(f"/calendars/{cal}/events/{listed[0]['id']}").status_code == 204
    assert [e["title"] for e in client.get(f"/calendars/{cal}/events").json()] == ["Tournament"]
    assert client.delete(f"/calendars/{cal}/events/{listed[0]['id']}").status_code == 404  # already gone


def test_bulk_add_is_all_or_nothing(client):
    cal = make_calendar(client)
    bad = {**SPRING, "start_date": "2027-04-09", "end_date": "2027-04-05"}  # ends before it starts
    assert client.post(f"/calendars/{cal}/events/bulk", json={"events": [TOURNAMENT, bad]}).status_code == 422
    assert client.get(f"/calendars/{cal}/events").json() == []
    assert client.post(f"/calendars/{cal}/events/bulk", json={"events": []}).status_code == 422


def test_shared_and_other_peoples_calendars_cannot_be_changed(client):
    nyc = next(c["id"] for c in client.get("/calendars", params={"kind": "SCHOOL"}).json())
    assert client.get(f"/calendars/{nyc}/events").status_code == 200  # anyone can read a shared calendar
    assert client.post(f"/calendars/{nyc}/events/bulk", json={"events": [SPRING]}).status_code == 403
    assert client.delete(f"/calendars/{nyc}").status_code == 403
    assert client.post("/calendars/1/events/bulk", json={"events": [SPRING]}).status_code == 400  # federal

    mine = make_calendar(client)
    event = client.post(f"/calendars/{mine}/events/bulk", json={"events": [SPRING]}).json()[0]
    sign_in(client, "stranger@example.com")
    assert client.get(f"/calendars/{mine}/events").status_code == 404  # private
    assert client.post(f"/calendars/{mine}/events/bulk", json={"events": [SPRING]}).status_code == 404
    assert client.delete(f"/calendars/{mine}/events/{event['id']}").status_code == 404
    assert client.delete(f"/calendars/{mine}").status_code == 404


def test_deleting_a_calendar_removes_it_from_the_people_using_it(client):
    cal = make_calendar(client)
    client.post(f"/calendars/{cal}/events/bulk", json={"events": [SPRING]})
    kid_id = kid(client)
    attach(client, kid_id, cal)
    assert [c["id"] for c in client.get(f"/people/{kid_id}/calendars").json()] == [cal]

    assert client.delete(f"/calendars/{cal}").status_code == 204
    assert client.get(f"/people/{kid_id}/calendars").json() == []
    assert db(client).scalars(orm.CalendarEvent.__table__.select().where(orm.CalendarEvent.calendar_id == cal)).all() == []


def test_a_persons_calendar_list_says_which_are_yours(client):
    pat = adult(client, "Pat", 10)  # has the federal calendar
    mine = make_calendar(client, "CUSTOM", "Pat's blackout dates")
    attach(client, pat, mine)

    # Someone else's private calendar, switched on for Pat by another account, stays out of sight.
    session = db(client)
    other = orm.Account(email="other@example.com", name="Other")
    session.add(other)
    session.flush()
    theirs = orm.Calendar(name="Other's private", kind=orm.CalendarKind.CUSTOM, owner_account_id=other.id)
    session.add(theirs)
    session.flush()
    session.add(orm.PersonCalendar(person_id=pat, calendar_id=theirs.id))
    session.commit()

    listed = client.get(f"/people/{pat}/calendars").json()
    assert {(c["name"], c["mine"]) for c in listed} == {("US Federal Holidays", False), ("Pat's blackout dates", True)}
    sign_in(client, "stranger@example.com")
    assert client.get(f"/people/{pat}/calendars").status_code == 404


def test_ics_preview_suggests_and_saves_nothing(client):
    text = ics_text(
        "SUMMARY:No School - Spring Recess\r\nDTSTART;VALUE=DATE:20270405\r\nDTEND;VALUE=DATE:20270410",
        "SUMMARY:Practice\r\nDTSTART:20270406T170000\r\nRRULE:FREQ=WEEKLY",
    )
    before = db(client).scalars(orm.Calendar.__table__.select()).all()
    response = client.post("/calendars/ics-preview", json={"text": text, "kind": "SCHOOL"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["skipped_recurring"] == 1
    assert body["events"] == [{
        "title": "No School - Spring Recess", "start_date": "2027-04-05", "end_date": "2027-04-09",
        "effect": "DAY_OFF", "selected": True, "timed": False,
    }]
    assert db(client).scalars(orm.Calendar.__table__.select()).all() == before


def test_ics_preview_rejects_bad_input(client):
    assert client.post("/calendars/ics-preview", json={"text": "not a calendar", "kind": "SCHOOL"}).status_code == 422
    assert client.post("/calendars/ics-preview", json={"text": "x" * 1_000_001, "kind": "SCHOOL"}).status_code == 422
    assert client.post("/calendars/ics-preview", json={"text": ics_text(), "kind": "FEDERAL"}).status_code == 422
    client.headers.pop("Authorization")
    assert client.post("/calendars/ics-preview", json={"text": ics_text(), "kind": "SCHOOL"}).status_code == 401


def test_a_kid_needs_a_school_calendar_before_any_trip_fits(client):
    """A kid with no calendar has school every weekday, so the weekday trip isn't offered.
    Entering the kid's spring break makes it appear, and costs the parent 5 days."""
    parent = adult(client, "Parent", 10)
    kid_id = kid(client)
    gid = group(client, parent, kid_id)
    assert find(windows(client, gid, **SEARCH)["windows"], "2027-04-03", "2027-04-11") is None

    cal = make_calendar(client)
    client.post(f"/calendars/{cal}/events/bulk", json={"events": [SPRING]})
    attach(client, kid_id, cal)
    week = find(windows(client, gid, **SEARCH)["windows"], "2027-04-03", "2027-04-11")
    assert week["pto_cost"] == {"Parent": 5, "Kid": 0}


def test_a_busy_day_blocks_the_trip_and_deleting_it_brings_the_trip_back(client):
    parent = adult(client, "Parent", 10)
    kid_id = kid(client)
    school = make_calendar(client)
    client.post(f"/calendars/{school}/events/bulk", json={"events": [SPRING]})
    attach(client, kid_id, school)
    sports = make_calendar(client, "LEAGUE", "Soccer")
    tournament = client.post(f"/calendars/{sports}/events/bulk", json={"events": [TOURNAMENT]}).json()[0]
    attach(client, kid_id, sports)
    gid = group(client, parent, kid_id)

    assert find(windows(client, gid, **SEARCH)["windows"], "2027-04-03", "2027-04-11") is None
    client.delete(f"/calendars/{sports}/events/{tournament['id']}")
    assert find(windows(client, gid, **SEARCH)["windows"], "2027-04-03", "2027-04-11") is not None
