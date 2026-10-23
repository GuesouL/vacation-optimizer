"""A person's own schedules: a kid's school calendar, a team's games, work blackout dates.

Everything a user enters lives in a private calendar they own, attached to the
person it's about. The engine already knows what to do with it: a DAY_OFF event frees
a day (a school break), a BUSY event blocks it (a tournament). This module adds the
missing pieces around the create calls in api.py: see, delete and bulk-add events,
and turn an .ics file into suggestions to review.
"""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from . import orm
from .access import (
    can_see_group,
    manages,
    my_person,
    not_found,
    owned_calendar,
    usable_calendar,
)
from .auth import CurrentAccount
from .db import DB
from .ics import parse_ics
from .loader import events_in_range
from .schemas import (
    BulkEventsIn,
    EventOut,
    IcsEventOut,
    IcsIn,
    IcsPreviewOut,
    PersonCalendarOut,
    PersonScheduleOut,
    ScheduleItemOut,
)
from .search import MAX_SEARCH_DAYS, load_group

router = APIRouter()


@router.get("/people/{person_id}/calendars")
def person_calendars(person_id: int, account: CurrentAccount, session: DB) -> list[PersonCalendarOut]:
    """The calendars switched on for someone you manage. Another account's private
    calendar (a partner's, say) isn't listed: only shared ones and yours are."""
    my_person(session, account, person_id)
    links = session.scalars(
        select(orm.PersonCalendar).where(orm.PersonCalendar.person_id == person_id)
    )
    return [
        PersonCalendarOut(
            id=link.calendar.id,
            name=link.calendar.name,
            kind=link.calendar.kind,
            mine=link.calendar.owner_account_id == account.id,
            enabled=link.enabled,
            excluded_titles=link.excluded_titles,
        )
        for link in links
        if link.calendar.owner_account_id in (None, account.id)
    ]


@router.get("/calendars/{calendar_id}/events")
def list_events(calendar_id: int, account: CurrentAccount, session: DB) -> list[EventOut]:
    calendar = usable_calendar(session, account, calendar_id)
    return calendar.events  # ordered by start date (see orm.Calendar)


@router.post("/calendars/{calendar_id}/events/bulk", status_code=201)
def add_events(calendar_id: int, body: BulkEventsIn, account: CurrentAccount, session: DB) -> list[EventOut]:
    """Add many events in one go. All of them or none: one bad row saves nothing."""
    owned_calendar(session, account, calendar_id)
    events = [orm.CalendarEvent(calendar_id=calendar_id, **e.model_dump()) for e in body.events]
    session.add_all(events)
    session.commit()
    return sorted(events, key=lambda e: (e.start_date, e.end_date))


@router.delete("/calendars/{calendar_id}/events/{event_id}", status_code=204)
def delete_event(calendar_id: int, event_id: int, account: CurrentAccount, session: DB) -> None:
    owned_calendar(session, account, calendar_id)
    event = session.get(orm.CalendarEvent, event_id)
    if event is None or event.calendar_id != calendar_id:
        raise not_found(orm.CalendarEvent, event_id)
    session.delete(event)
    session.commit()


@router.delete("/calendars/{calendar_id}", status_code=204)
def delete_calendar(calendar_id: int, account: CurrentAccount, session: DB) -> None:
    """Delete one of your calendars with all its events. People it was switched on
    for just lose it (the database removes those links)."""
    session.delete(owned_calendar(session, account, calendar_id))
    session.commit()


@router.post("/calendars/ics-preview")
def ics_preview(body: IcsIn, account: CurrentAccount) -> IcsPreviewOut:
    """Read an .ics file and suggest events. Saves nothing: the screen shows the
    suggestions, and what the user ticks is saved through /events/bulk."""
    try:
        result = parse_ics(body.text, body.kind)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return IcsPreviewOut(
        events=[
            IcsEventOut(
                title=c.title, start_date=c.start, end_date=c.end,
                effect=c.effect, selected=c.selected, timed=c.timed,
            )
            for c in result.events
        ],
        skipped_recurring=result.skipped_recurring,
        skipped_too_long=result.skipped_too_long,
        skipped_invalid=result.skipped_invalid,
        truncated=result.truncated,
    )


@router.get("/groups/{group_id}/schedule")
def group_schedule(
    group_id: int, start: date, end: date, account: CurrentAccount, session: DB
) -> list[PersonScheduleOut]:
    """The school breaks, games and blackout dates of the people YOU manage in this group,
    so the calendar can draw them. Other families' people are left out entirely: they
    share a name and whether a trip works, never their schedule.

    Federal holidays aren't included (the page already draws them). Everything else
    follows the same rules the search uses: only calendars switched on for the person,
    and not the holidays they've said their job skips.
    """
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    if end - start > timedelta(days=MAX_SEARCH_DAYS):
        raise HTTPException(422, f"Look at most {MAX_SEARCH_DAYS} days at a time")
    group = load_group(session, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)

    mine = [m.person for m in group.members if manages(account, m.person)]
    links = {
        p.id: [l for l in p.calendars if l.enabled and not l.calendar.kind.computed]
        for p in mine
    }
    calendar_ids = {l.calendar_id for person_links in links.values() for l in person_links}
    events = events_in_range(session, calendar_ids, start, end) if calendar_ids else {}

    out = []
    for person in mine:
        # The engine applies a person's skipped titles to all of their calendars, so do the same.
        skipped = {t for l in links[person.id] for t in l.excluded_titles}
        items = [
            ScheduleItemOut(
                title=e.title, start_date=e.start_date, end_date=e.end_date,
                effect=e.effect, kind=l.calendar.kind,
            )
            for l in links[person.id]
            for e in events.get(l.calendar_id, [])
            if e.title not in skipped
        ]
        items.sort(key=lambda i: (i.start_date, i.end_date, i.title))
        out.append(PersonScheduleOut(person_id=person.id, name=person.name, kind=person.kind, items=items))
    return out
