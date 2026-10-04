"""Turns database rows into the engine's plain dataclasses.

This is the only place that knows about both worlds, like an adapter harness
between a new part and an old connector.
"""

from datetime import date

from . import models, orm
from .holidays import federal_calendar


def to_engine_person(row: orm.Person, start: date, end: date) -> models.Person:
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
                for e in link.calendar.events
            ]))

    return models.Person(
        name=row.name,
        pto_balance=row.pto_balance,
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
