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


# --- What the calendar draws -------------------------------------------------

WINDOW = {"start": "2027-03-01", "end": "2027-06-30"}


def schedule(client, gid, **params):
    response = client.get(f"/groups/{gid}/schedule", params={**WINDOW, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_the_calendar_gets_the_dates_of_the_people_you_manage(client):
    parent = adult(client, "Parent", 10)  # the federal calendar is switched on, but isn't drawn from here
    kid_id = kid(client)
    school = make_calendar(client)
    client.post(f"/calendars/{school}/events/bulk", json={"events": [SPRING, {**SPRING, "title": "Fall", "start_date": "2026-10-12", "end_date": "2026-10-12"}]})
    attach(client, kid_id, school)
    sports = make_calendar(client, "LEAGUE", "Soccer")
    client.post(f"/calendars/{sports}/events/bulk", json={"events": [TOURNAMENT]})
    attach(client, kid_id, sports)
    gid = group(client, parent, kid_id)

    result = schedule(client, gid)
    assert [p["name"] for p in result] == ["Parent", "Kid"]
    assert result[0]["items"] == []  # federal holidays aren't repeated here
    assert [(i["title"], i["effect"], i["kind"]) for i in result[1]["items"]] == [
        ("Spring Break", "DAY_OFF", "SCHOOL"),
        ("Tournament", "BUSY", "LEAGUE"),
    ]  # "Fall" is outside the asked-for dates; the rest are sorted by date


def test_events_touching_the_range_edges_are_included(client):
    kid_id = kid(client)
    school = make_calendar(client)
    client.post(f"/calendars/{school}/events/bulk", json={"events": [
        {**SPRING, "title": "Starts before", "start_date": "2027-02-25", "end_date": "2027-03-02"},
        {**SPRING, "title": "Ends after", "start_date": "2027-06-29", "end_date": "2027-07-05"},
        {**SPRING, "title": "Just before", "start_date": "2027-02-27", "end_date": "2027-02-28"},
    ]})
    attach(client, kid_id, school)
    gid = group(client, adult(client, "Parent", 10), kid_id)
    titles = [i["title"] for i in schedule(client, gid)[1]["items"]]
    assert titles == ["Starts before", "Ends after"]


def test_skipped_titles_and_switched_off_calendars_are_left_out_like_the_search_does(client):
    person = adult(client, "Parent", 10)
    mine = make_calendar(client, "WORK", "Work")
    client.post(f"/calendars/{mine}/events/bulk", json={"events": [SPRING, TOURNAMENT]})
    client.post(f"/people/{person}/calendars", json={"calendar_id": mine, "excluded_titles": ["Spring Break"]})
    gid = group(client, person)
    assert [i["title"] for i in schedule(client, gid)[0]["items"]] == ["Tournament"]

    db(client).execute(orm.PersonCalendar.__table__.update().where(
        orm.PersonCalendar.person_id == person, orm.PersonCalendar.calendar_id == mine).values(enabled=False))
    assert schedule(client, gid)[0]["items"] == []


def test_other_families_schedules_stay_private(client):
    from test_sharing import make_link, me_adult

    pat = me_adult(client, "Pat Smith", 10)
    group_id = client.post("/groups", json={"name": "Trip", "person_ids": [pat]}).json()["id"]
    cal = make_calendar(client, "CUSTOM", "Pat's dates")
    client.post(f"/calendars/{cal}/events/bulk", json={"events": [TOURNAMENT]})
    attach(client, pat, cal)
    invite = make_link(client, group_id, "INVITE")

    sign_in(client, "lee@example.com")
    lee = me_adult(client, "Lee Jones", 10)
    client.post(f"/links/{invite['token']}/accept", json={"person_ids": [lee]})
    result = schedule(client, group_id)
    assert [p["name"] for p in result] == ["Lee Jones"]  # no Pat, and so none of Pat's dates

    sign_in(client, "stranger@example.com")
    assert client.get(f"/groups/{group_id}/schedule", params=WINDOW).status_code == 404


def test_bad_ranges_are_rejected(client):
    gid = group(client, adult(client, "Parent", 10))
    assert client.get(f"/groups/{gid}/schedule", params={"start": "2027-06-30", "end": "2027-03-01"}).status_code == 422
    assert client.get(f"/groups/{gid}/schedule", params={"start": "2026-01-01", "end": "2028-01-01"}).status_code == 422
    assert client.get(f"/groups/{gid}/schedule", params={"start": "2027-03-01"}).status_code == 422
