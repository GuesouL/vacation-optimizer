"""FastAPI app: the HTTP layer over the database and the optimizer engine."""

import os
from datetime import date, timedelta
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from . import orm
from .auth import CurrentAccount
from .db import get_session
from .engine import SortOrder, distinct_windows, find_windows
from .holidays import federal_calendar
from .loader import events_in_range, to_engine_person
from .models import Window
from .schemas import (
    CalendarIn,
    CalendarOut,
    EventIn,
    EventOut,
    GroupIn,
    GroupOut,
    GroupSummary,
    MeOut,
    PersonIn,
    PersonOut,
    PTOBlockIn,
    PTOBlockOut,
    SearchOut,
    SubscribeIn,
    WindowOut,
)

app = FastAPI(title="Vacation Optimizer")

# Browsers block a page on one address (localhost:3000) from calling an API on
# another (localhost:8000) unless the API says that page is allowed. That's CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
DB = Annotated[Session, Depends(get_session)]

MAX_SEARCH_DAYS = 400  # about 13 months; keeps one search fast


def not_found(model, id: int) -> HTTPException:
    # Someone else's row gets the same 404 as a missing one, so ids can't be
    # probed to learn what exists.
    return HTTPException(404, f"{model.__name__} {id} not found")


def manages(account: orm.Account, person: orm.Person) -> bool:
    return account.id in (person.managed_by_account_id, person.linked_account_id)


def my_person(session: Session, account: orm.Account, person_id: int) -> orm.Person:
    person = session.get(orm.Person, person_id)
    if person is None or not manages(account, person):
        raise not_found(orm.Person, person_id)
    return person


def usable_calendar(session: Session, account: orm.Account, calendar_id: int) -> orm.Calendar:
    """Shared calendars (no owner) are open to everyone; private ones only to their owner."""
    calendar = session.get(orm.Calendar, calendar_id)
    if calendar is None or calendar.owner_account_id not in (None, account.id):
        raise not_found(orm.Calendar, calendar_id)
    return calendar


def can_see_group(account: orm.Account, group: orm.Group) -> bool:
    return group.owner_account_id == account.id or any(
        manages(account, member.person) for member in group.members
    )


def my_group(session: Session, account: orm.Account, group_id: int) -> orm.Group:
    group = session.get(orm.Group, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    return group


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


# --- Me -------------------------------------------------------------------


def my_people_filter(account: orm.Account):
    return or_(
        orm.Person.managed_by_account_id == account.id,
        orm.Person.linked_account_id == account.id,
    )


@app.get("/me")
def me(account: CurrentAccount, session: DB) -> MeOut:
    """Who's signed in, the people they manage, and the groups they can open."""
    people = session.scalars(
        select(orm.Person).where(my_people_filter(account)).order_by(orm.Person.id)
    ).all()
    member_of = select(orm.GroupMember.group_id).join(orm.Person).where(my_people_filter(account))
    groups = session.scalars(
        select(orm.Group)
        .where(or_(orm.Group.owner_account_id == account.id, orm.Group.id.in_(member_of)))
        .order_by(orm.Group.id)
    ).all()
    return MeOut(
        email=account.email,
        name=account.name,
        self_person_id=next((p.id for p in people if p.linked_account_id == account.id), None),
        people=people,
        groups=[GroupSummary(id=g.id, name=g.name) for g in groups],
    )


# --- People ---------------------------------------------------------------


@app.post("/people", status_code=201)
def create_person(body: PersonIn, account: CurrentAccount, session: DB) -> PersonOut:
    fields = body.model_dump(exclude={"is_self"})
    person = orm.Person(**fields, managed_by_account_id=account.id)
    if body.is_self:
        already = session.scalars(
            select(orm.Person.id).where(orm.Person.linked_account_id == account.id)
        ).first()
        if already is not None:
            raise HTTPException(409, "You already have a profile for yourself")
        person.linked_account_id = account.id
    session.add(person)
    session.commit()
    return person


@app.post("/people/{person_id}/calendars", status_code=204)
def subscribe(person_id: int, body: SubscribeIn, account: CurrentAccount, session: DB) -> None:
    """Turn a calendar on for a person (or update their excluded holidays)."""
    my_person(session, account, person_id)
    usable_calendar(session, account, body.calendar_id)
    session.merge(orm.PersonCalendar(person_id=person_id, enabled=True, **body.model_dump()))
    session.commit()


@app.post("/people/{person_id}/pto-blocks", status_code=201)
def add_pto_block(
    person_id: int, body: PTOBlockIn, account: CurrentAccount, session: DB
) -> PTOBlockOut:
    my_person(session, account, person_id)
    block = orm.PTOBlock(person_id=person_id, **body.model_dump())
    session.add(block)
    session.commit()
    return block


# --- Calendars ------------------------------------------------------------


@app.get("/calendars")
def list_calendars(account: CurrentAccount, session: DB) -> list[CalendarOut]:
    """Shared calendars plus this account's own."""
    owner = orm.Calendar.owner_account_id
    return session.scalars(
        select(orm.Calendar).where(or_(owner.is_(None), owner == account.id)).order_by(orm.Calendar.id)
    ).all()


@app.post("/calendars", status_code=201)
def create_calendar(body: CalendarIn, account: CurrentAccount, session: DB) -> CalendarOut:
    calendar = orm.Calendar(**body.model_dump(), owner_account_id=account.id)
    session.add(calendar)
    session.commit()
    return calendar


@app.post("/calendars/{calendar_id}/events", status_code=201)
def add_event(calendar_id: int, body: EventIn, account: CurrentAccount, session: DB) -> EventOut:
    calendar = usable_calendar(session, account, calendar_id)
    if calendar.kind is orm.CalendarKind.FEDERAL:
        raise HTTPException(400, "Federal holidays are computed, not stored")
    if calendar.owner_account_id != account.id:
        # Shared calendars are read-only here; everyone relies on them.
        raise HTTPException(403, "Only the calendar's owner can add events")
    event = orm.CalendarEvent(calendar_id=calendar_id, **body.model_dump())
    session.add(event)
    session.commit()
    return event


# --- Groups and the optimizer --------------------------------------------


def group_out(group: orm.Group) -> GroupOut:
    people = [PersonOut.model_validate(m.person) for m in group.members]
    return GroupOut(id=group.id, name=group.name, people=people)


@app.post("/groups", status_code=201)
def create_group(body: GroupIn, account: CurrentAccount, session: DB) -> GroupOut:
    for person_id in set(body.person_ids):
        my_person(session, account, person_id)  # other families join by invite instead
    group = orm.Group(
        name=body.name,
        owner_account_id=account.id,
        members=[orm.GroupMember(person_id=pid) for pid in dict.fromkeys(body.person_ids)],
    )
    session.add(group)
    session.commit()
    return group_out(group)


@app.get("/groups/{group_id}")
def get_group(group_id: int, account: CurrentAccount, session: DB) -> GroupOut:
    return group_out(my_group(session, account, group_id))


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
    account: CurrentAccount,
    session: DB,
    start: date,
    end: date,
    min_days: Annotated[int, Query(ge=2, le=31)] = 3,
    max_days: Annotated[int, Query(ge=2, le=31)] = 16,
    sort: SortOrder = "best_value",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    distinct: bool = True,
) -> SearchOut:
    """Rank the vacation windows everyone in the group can share."""
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    if end - start > timedelta(days=MAX_SEARCH_DAYS):
        raise HTTPException(422, f"Search at most {MAX_SEARCH_DAYS} days at a time")
    if min_days > max_days:
        raise HTTPException(422, "min_days must be at most max_days")

    # selectinload fetches every person's calendars and PTO in a few queries up
    # front, instead of one query per person (the "N+1" problem). Events are
    # loaded separately, filtered to the search dates by the database.
    group = session.scalars(
        select(orm.Group)
        .where(orm.Group.id == group_id)
        .options(
            selectinload(orm.Group.members).selectinload(orm.GroupMember.person).options(
                selectinload(orm.Person.calendars).selectinload(orm.PersonCalendar.calendar),
                selectinload(orm.Person.pto_blocks),
            )
        )
    ).one_or_none()
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)

    calendar_ids = {link.calendar_id for m in group.members for link in m.person.calendars}
    # Load holidays through Dec 31 even when the search ends sooner: a booked
    # trip in December that covers Christmas mustn't be charged for Christmas.
    load_end = max(end, date(start.year, 12, 31))
    events = events_in_range(session, calendar_ids, start, load_end)
    people = [to_engine_person(m.person, start, load_end, events) for m in group.members]
    # PTO costs are keyed by name, so two people both named "Sam" get their ids added.
    names = [p.name for p in people]
    for person, member in zip(people, group.members):
        if names.count(person.name) > 1:
            person.name = f"{person.name} (#{member.person_id})"
    result = find_windows(people, start, end, min_days, max_days, sort)
    if distinct:  # one suggestion per real break, not five overlapping versions of it
        result.windows = distinct_windows(result.windows)
        result.free_long_weekends = distinct_windows(result.free_long_weekends)
    return SearchOut(
        windows=[window_out(w) for w in result.windows[:limit]],
        free_long_weekends=[window_out(w) for w in result.free_long_weekends[:limit]],
        message=result.message,
    )
