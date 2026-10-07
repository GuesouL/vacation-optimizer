"""Run the optimizer for a group. Shared by the private plan and the public view link."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Annotated

from fastapi import HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import orm
from .engine import SortOrder, distinct_windows, find_windows
from .loader import events_in_range, to_engine_person
from .models import Window
from .schemas import SearchOut, WindowOut

MAX_SEARCH_DAYS = 400  # about 13 months; keeps one search fast


@dataclass
class SearchParams:
    """Query-string options. FastAPI fills this in when it's used as Depends()."""

    start: date
    end: date
    min_days: Annotated[int, Query(ge=2, le=31)] = 3
    max_days: Annotated[int, Query(ge=2, le=31)] = 16
    sort: SortOrder = "best_value"
    limit: Annotated[int, Query(ge=1, le=200)] = 25
    distinct: bool = True

    def check(self) -> None:
        if self.end < self.start:
            raise HTTPException(422, "end must be on or after start")
        if self.end - self.start > timedelta(days=MAX_SEARCH_DAYS):
            raise HTTPException(422, f"Search at most {MAX_SEARCH_DAYS} days at a time")
        if self.min_days > self.max_days:
            raise HTTPException(422, "min_days must be at most max_days")


def load_group(session: Session, group_id: int) -> orm.Group | None:
    # selectinload fetches every person's calendars and PTO in a few queries up
    # front, instead of one query per person (the "N+1" problem).
    return session.scalars(
        select(orm.Group)
        .where(orm.Group.id == group_id)
        .options(
            selectinload(orm.Group.members).selectinload(orm.GroupMember.person).options(
                selectinload(orm.Person.calendars).selectinload(orm.PersonCalendar.calendar),
                selectinload(orm.Person.pto_blocks),
            )
        )
    ).one_or_none()


def window_out(window: Window) -> WindowOut:
    return WindowOut(
        start=window.start,
        end=window.end,
        days=window.days,
        pto_cost=window.pto_cost,
        score=window.score if window.bottleneck_cost else None,
    )


def search_group(
    session: Session,
    group: orm.Group,
    params: SearchParams,
    label: Callable[[orm.Person], str] = lambda person: person.name,
) -> SearchOut:
    """Rank the windows everyone in the group can share. `label` names each
    person in the results (the view link shows first names only)."""
    params.check()
    start, end = params.start, params.end
    calendar_ids = {link.calendar_id for m in group.members for link in m.person.calendars}
    # Load holidays through Dec 31 even when the search ends sooner: a booked
    # trip in December that covers Christmas mustn't be charged for Christmas.
    load_end = max(end, date(start.year, 12, 31))
    events = events_in_range(session, calendar_ids, start, load_end)
    people = [to_engine_person(m.person, start, load_end, events) for m in group.members]
    # PTO costs are keyed by name, so two people both named "Sam" get their ids added.
    names = [label(m.person) for m in group.members]
    for person, member, name in zip(people, group.members, names):
        person.name = f"{name} (#{member.person_id})" if names.count(name) > 1 else name
    result = find_windows(people, start, end, params.min_days, params.max_days, params.sort)
    if params.distinct:  # one suggestion per real break, not five overlapping versions of it
        result.windows = distinct_windows(result.windows)
        result.free_long_weekends = distinct_windows(result.free_long_weekends)
    return SearchOut(
        windows=[window_out(w) for w in result.windows[: params.limit]],
        free_long_weekends=[window_out(w) for w in result.free_long_weekends[: params.limit]],
        message=result.message,
    )
