"""Turns database rows into the engine's plain dataclasses.

This is the only place that knows about both worlds, like an adapter harness
between a new part and an old connector.
"""

from collections import defaultdict
from datetime import date

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from . import models, orm
from .holidays import federal_calendar


def overlapping_events(calendar_ids: set[int], start: date, end: date) -> Select:
    event = orm.CalendarEvent
    return (
        select(event)
        .where(event.calendar_id.in_(calendar_ids))
        .where(orm.date_span(event.start_date, event.end_date).op("&&")(orm.date_span(start, end)))
        .order_by(event.start_date)
    )


def events_in_range(
    session: Session, calendar_ids: set[int], start: date, end: date
) -> dict[int, list[orm.CalendarEvent]]:
    """Only the events that touch the search dates, grouped by calendar.

    `&&` is Postgres's "ranges overlap" operator. The GiST index on
    (calendar_id, daterange) answers it without reading every year of every
    calendar, and Python only ever receives the rows it needs.
    """
    rows = session.scalars(overlapping_events(calendar_ids, start, end))
    grouped: dict[int, list[orm.CalendarEvent]] = defaultdict(list)
    for row in rows:
        grouped[row.calendar_id].append(row)
    return grouped


def to_engine_person(
    row: orm.Person,
    start: date,
    end: date,
    events: dict[int, list[orm.CalendarEvent]],
) -> models.Person:
    calendars = []
    excluded: set[str] = set()
    for link in row.calendars:
        if not link.enabled:
            continue
        excluded.update(link.excluded_titles)
        if link.calendar.kind is orm.CalendarKind.FEDERAL:
            # Federal holidays aren't stored; compute them for exactly this range.
            calendars.append(federal_calendar(start, end))
        else:
            calendars.append(models.Calendar(link.calendar.name, [
                models.CalendarEvent(e.start_date, e.end_date, e.effect, e.title)
                for e in events.get(link.calendar_id, [])
            ]))

    renews_on = (row.pto_renewal_month, row.pto_renewal_day) if row.pto_renewal_month else (1, 1)
    return models.Person(
        name=row.name,
        pto_balance=row.pto_balance,
        pto_allowance=row.pto_allowance,
        pto_renews_on=renews_on,
        pto_carryover_max=row.pto_carryover_max or 0,
        work_week=frozenset(row.work_week),
        calendars=calendars,
        excluded_events=excluded,
        # Only COMMITTED PTO is real. PROPOSED blocks are ideas, not bookings.
        committed_pto=[
            models.PTOBlock(b.start_date, b.end_date)
            for b in row.pto_blocks
            if b.status is orm.PTOStatus.COMMITTED
        ],
    )
