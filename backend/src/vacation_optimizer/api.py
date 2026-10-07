"""FastAPI app: the HTTP layer over the database and the optimizer engine."""

import os
from datetime import date
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import or_, select

from . import orm, sharing
from .access import (
    can_see_group,
    manages,
    my_group,
    my_person,
    not_found,
    role_in,
    usable_calendar,
)
from .auth import CurrentAccount
from .db import DB
from .holidays import federal_calendar
from .schemas import (
    AddMembersIn,
    CalendarIn,
    CalendarOut,
    EventIn,
    EventOut,
    GroupIn,
    GroupOut,
    GroupSummary,
    MemberOut,
    MeOut,
    PersonIn,
    PersonOut,
    PTOBlockIn,
    PTOBlockOut,
    SearchOut,
    SubscribeIn,
)
from .search import SearchParams, load_group, search_group

app = FastAPI(title="Vacation Optimizer")

# Browsers block a page on one address (localhost:3000) from calling an API on
# another (localhost:8000) unless the API says that page is allowed. That's CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        groups=[GroupSummary(id=g.id, name=g.name, role=role_in(account, g)) for g in groups],
    )


# --- People ---------------------------------------------------------------


@app.post("/people", status_code=201)
def create_person(body: PersonIn, account: CurrentAccount, session: DB) -> PersonOut:
    person = orm.Person(**body.columns(), managed_by_account_id=account.id)
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
def list_calendars(
    account: CurrentAccount, session: DB, kind: orm.CalendarKind | None = None
) -> list[CalendarOut]:
    """Shared calendars plus this account's own. `?kind=SCHOOL` lists school districts."""
    owner = orm.Calendar.owner_account_id
    query = select(orm.Calendar).where(or_(owner.is_(None), owner == account.id))
    if kind is not None:
        query = query.where(orm.Calendar.kind == kind)
    return session.scalars(query.order_by(orm.Calendar.name)).all()


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


def group_out(group: orm.Group, account: orm.Account) -> GroupOut:
    people = []
    for member in group.members:
        person, mine = member.person, manages(account, member.person)
        # Free/busy privacy: other families see a name, never a balance or schedule.
        people.append(MemberOut(
            id=person.id,
            name=person.name,
            kind=person.kind,
            mine=mine,
            pto_balance=person.pto_balance if mine else None,
            work_week=person.work_week if mine else None,
        ))
    return GroupOut(id=group.id, name=group.name, role=role_in(account, group), people=people)


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
    return group_out(group, account)


@app.get("/groups/{group_id}")
def get_group(group_id: int, account: CurrentAccount, session: DB) -> GroupOut:
    return group_out(my_group(session, account, group_id), account)


@app.post("/groups/{group_id}/members")
def add_members(group_id: int, body: AddMembersIn, account: CurrentAccount, session: DB) -> GroupOut:
    """Bring more of your own people (a kid, a partner) into a group you're in."""
    group = my_group(session, account, group_id)
    already = {m.person_id for m in group.members}
    for person_id in dict.fromkeys(body.person_ids):
        my_person(session, account, person_id)
        if person_id not in already:
            group.members.append(orm.GroupMember(person_id=person_id))
    session.commit()
    return group_out(group, account)


@app.delete("/groups/{group_id}/members/{person_id}", status_code=204)
def remove_member(group_id: int, person_id: int, account: CurrentAccount, session: DB) -> None:
    """The owner can remove anyone; a member can take their own people out."""
    group = my_group(session, account, group_id)
    member = next((m for m in group.members if m.person_id == person_id), None)
    if member is None:
        raise not_found(orm.Person, person_id)
    if role_in(account, group) != "OWNER" and not manages(account, member.person):
        raise HTTPException(403, "You can only remove your own people")
    group.members.remove(member)
    session.commit()


@app.get("/groups/{group_id}/windows")
def optimize(
    group_id: int,
    account: CurrentAccount,
    session: DB,
    params: Annotated[SearchParams, Depends()],
) -> SearchOut:
    """Rank the vacation windows everyone in the group can share."""
    group = load_group(session, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    return search_group(session, group, params)


app.include_router(sharing.router)
