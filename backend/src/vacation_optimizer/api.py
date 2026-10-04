"""FastAPI app: the HTTP layer over the database and the optimizer engine."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import orm
from .db import get_session
from .engine import SortOrder, find_windows
from .holidays import federal_calendar
from .loader import to_engine_person
from .models import Window
from .schemas import (
    CalendarIn,
    CalendarOut,
    EventIn,
    EventOut,
    GroupIn,
    GroupOut,
    PersonIn,
    PersonOut,
    PTOBlockIn,
    PTOBlockOut,
    SearchOut,
    SubscribeIn,
    WindowOut,
)

app = FastAPI(title="Vacation Optimizer")
DB = Annotated[Session, Depends(get_session)]

MAX_SEARCH_DAYS = 400  # about 13 months; keeps one search fast


def get_or_404(session: Session, model, id: int):
    row = session.get(model, id)
    if row is None:
        raise HTTPException(404, f"{model.__name__} {id} not found")
    return row


class Holiday(BaseModel):
    date: date
    name: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/holidays/{year}")
def holidays(year: int) -> list[Holiday]:
    """Observed federal holidays that fall in `year` (including next year's
    New Year's when it's observed on Dec 31)."""
    calendar = federal_calendar(date(year, 1, 1), date(year, 12, 31))
    return [Holiday(date=e.start, name=e.title) for e in calendar.events]


# --- People ---------------------------------------------------------------


@app.post("/people", status_code=201)
def create_person(body: PersonIn, session: DB) -> PersonOut:
    person = orm.Person(**body.model_dump())
    session.add(person)
    session.commit()
    return person


@app.post("/people/{person_id}/calendars", status_code=204)
def subscribe(person_id: int, body: SubscribeIn, session: DB) -> None:
    """Turn a calendar on for a person (or update their excluded holidays)."""
    get_or_404(session, orm.Person, person_id)
    get_or_404(session, orm.Calendar, body.calendar_id)
    session.merge(orm.PersonCalendar(person_id=person_id, enabled=True, **body.model_dump()))
    session.commit()


@app.post("/people/{person_id}/pto-blocks", status_code=201)
def add_pto_block(person_id: int, body: PTOBlockIn, session: DB) -> PTOBlockOut:
    get_or_404(session, orm.Person, person_id)
    block = orm.PTOBlock(person_id=person_id, **body.model_dump())
    session.add(block)
    session.commit()
    return block


# --- Calendars ------------------------------------------------------------


@app.get("/calendars")
def list_calendars(session: DB) -> list[CalendarOut]:
    return session.scalars(select(orm.Calendar).order_by(orm.Calendar.id)).all()


@app.post("/calendars", status_code=201)
def create_calendar(body: CalendarIn, session: DB) -> CalendarOut:
    calendar = orm.Calendar(**body.model_dump())
    session.add(calendar)
    session.commit()
    return calendar


@app.post("/calendars/{calendar_id}/events", status_code=201)
def add_event(calendar_id: int, body: EventIn, session: DB) -> EventOut:
    calendar = get_or_404(session, orm.Calendar, calendar_id)
    if calendar.kind is orm.CalendarKind.FEDERAL:
        raise HTTPException(400, "Federal holidays are computed, not stored")
    event = orm.CalendarEvent(calendar_id=calendar_id, **body.model_dump())
    session.add(event)
    session.commit()
    return event


# --- Groups and the optimizer --------------------------------------------


def group_out(group: orm.Group) -> GroupOut:
    people = [PersonOut.model_validate(m.person) for m in group.members]
    return GroupOut(id=group.id, name=group.name, people=people)


@app.post("/groups", status_code=201)
def create_group(body: GroupIn, session: DB) -> GroupOut:
    for person_id in set(body.person_ids):
        get_or_404(session, orm.Person, person_id)
    group = orm.Group(
        name=body.name,
        members=[orm.GroupMember(person_id=pid) for pid in dict.fromkeys(body.person_ids)],
    )
    session.add(group)
    session.commit()
    return group_out(group)


def window_out(window: Window) -> WindowOut:
    return WindowOut(
        start=window.start,
        end=window.end,
        days=window.days,
        pto_cost=window.pto_cost,
        score=window.score if window.bottleneck_cost else None,
    )


@app.get("/groups/{group_id}/windows")
def optimize(
    group_id: int,
    session: DB,
    start: date,
    end: date,
    min_days: Annotated[int, Query(ge=2, le=31)] = 3,
    max_days: Annotated[int, Query(ge=2, le=31)] = 16,
    sort: SortOrder = "best_value",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
) -> SearchOut:
    """Rank the vacation windows everyone in the group can share."""
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    if end - start > timedelta(days=MAX_SEARCH_DAYS):
        raise HTTPException(422, f"Search at most {MAX_SEARCH_DAYS} days at a time")
    if min_days > max_days:
        raise HTTPException(422, "min_days must be at most max_days")

    # selectinload fetches every person's calendars, events and PTO in a few
    # queries up front, instead of one query per person (the "N+1" problem).
    group = session.scalars(
        select(orm.Group)
        .where(orm.Group.id == group_id)
        .options(
            selectinload(orm.Group.members).selectinload(orm.GroupMember.person).options(
                selectinload(orm.Person.calendars)
                .selectinload(orm.PersonCalendar.calendar)
                .selectinload(orm.Calendar.events),
                selectinload(orm.Person.pto_blocks),
            )
        )
    ).one_or_none()
    if group is None:
        raise HTTPException(404, f"Group {group_id} not found")

    people = [to_engine_person(m.person, start, end) for m in group.members]
    # PTO costs are keyed by name, so two people both named "Sam" get their ids added.
    names = [p.name for p in people]
    for person, member in zip(people, group.members):
        if names.count(person.name) > 1:
            person.name = f"{person.name} (#{member.person_id})"
    result = find_windows(people, start, end, min_days, max_days, sort)
    return SearchOut(
        windows=[window_out(w) for w in result.windows[:limit]],
        free_long_weekends=[window_out(w) for w in result.free_long_weekends[:limit]],
        message=result.message,
    )
