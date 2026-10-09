"""A person's own schedules: a kid's school calendar, a team's games, work blackout dates.

Everything a user enters lives in a private calendar they own, attached to the
person it's about. The engine already knows what to do with it: a DAY_OFF event frees
a day (a school break), a BUSY event blocks it (a tournament). This module adds the
missing pieces around the create calls in api.py: see, delete and bulk-add events,
and turn an .ics file into suggestions to review.
"""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from . import orm
from .access import my_person, not_found, owned_calendar, usable_calendar
from .auth import CurrentAccount
from .db import DB
from .ics import parse_ics
from .schemas import (
    BulkEventsIn,
    EventOut,
    IcsEventOut,
    IcsIn,
    IcsPreviewOut,
    PersonCalendarOut,
)

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
