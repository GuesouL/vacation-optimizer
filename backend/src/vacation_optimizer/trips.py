"""Saved trips: dates a group picked from the plan, and who has booked them.

A trip belongs to the group, like one repair order for the whole car. Booking
it is personal: each adult's share is their own COMMITTED pto_block pointing at
the trip, so the engine counts those days as already off and takes them out of
that person's PTO. You only ever book PTO for people you manage; another family
books their own share.
"""

from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import ExclusionViolation
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import orm
from .access import can_see_group, manages, my_group, not_found, role_in
from .auth import CurrentAccount
from .db import DB
from .engine import booking_cost
from .loader import events_in_range, to_engine_person
from .schemas import TripIn, TripOut
from .search import load_group

router = APIRouter()


# The server runs on UTC, where "today" starts hours before it does in the US.
# Hawaii's date is the last US date to change, so using it never tells someone
# in the US that a trip starting today "already started". (US-only for now.)
LATEST_US_ZONE = ZoneInfo("Pacific/Honolulu")


def today() -> date:
    """The earliest date it still is anywhere in the US. A dependency, so tests can pin the clock."""
    return datetime.now(LATEST_US_ZONE).date()


Today = Annotated[date, Depends(today)]


def is_double_booking(error: IntegrityError) -> bool:
    return isinstance(error.orig, ExclusionViolation)


def bookable_adults(account: orm.Account, group: orm.Group) -> list[orm.Person]:
    """The adults in this group whose PTO this account may book."""
    return [
        m.person for m in group.members
        if m.person.kind is orm.PersonKind.ADULT and manages(account, m.person)
    ]


def trip_out(trip: orm.Trip, group: orm.Group, account: orm.Account) -> TripOut:
    booked_ids = {b.person_id for b in trip.bookings if b.status is orm.PTOStatus.COMMITTED}
    names = {m.person.id: m.person.name for m in group.members}
    mine = bookable_adults(account, group)
    return TripOut(
        id=trip.id,
        start_date=trip.start_date,
        end_date=trip.end_date,
        label=trip.label,
        booked_by=[names[pid] for pid in names if pid in booked_ids],  # group order
        can_book=bool(mine),
        mine_booked=bool(mine) and all(p.id in booked_ids for p in mine),
        can_delete=trip.created_by_account_id == account.id or role_in(account, group) == "OWNER",
    )


def group_trip(session: Session, group: orm.Group, trip_id: int) -> orm.Trip:
    trip = session.get(orm.Trip, trip_id)
    if trip is None or trip.group_id != group.id:
        raise not_found(orm.Trip, trip_id)
    return trip


def check_not_past(trip: orm.Trip | TripIn, now: date) -> None:
    if trip.start_date < now:
        raise HTTPException(422, "That trip has already started")


@router.get("/groups/{group_id}/trips")
def list_trips(group_id: int, account: CurrentAccount, session: DB) -> list[TripOut]:
    group = my_group(session, account, group_id)
    trips = session.scalars(
        select(orm.Trip).where(orm.Trip.group_id == group.id).order_by(orm.Trip.start_date, orm.Trip.end_date)
    )
    return [trip_out(t, group, account) for t in trips]


@router.post("/groups/{group_id}/trips", status_code=201)
def save_trip(group_id: int, body: TripIn, account: CurrentAccount, session: DB, now: Today) -> TripOut:
    """Save dates for the group. Nobody's PTO changes until they book it."""
    group = my_group(session, account, group_id)
    check_not_past(body, now)
    trip = orm.Trip(group_id=group.id, created_by_account_id=account.id, **body.model_dump())
    session.add(trip)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "These dates are already saved for this group") from None
    return trip_out(trip, group, account)


@router.delete("/groups/{group_id}/trips/{trip_id}", status_code=204)
def delete_trip(group_id: int, trip_id: int, account: CurrentAccount, session: DB) -> None:
    """Whoever saved it, or the group's owner. Everyone's bookings for it go too
    (the database cascades the delete), so their PTO comes back."""
    group = my_group(session, account, group_id)
    trip = group_trip(session, group, trip_id)
    if trip.created_by_account_id != account.id and role_in(account, group) != "OWNER":
        raise HTTPException(403, "Only whoever saved this trip, or the group's owner, can delete it")
    session.delete(trip)
    session.commit()


@router.post("/groups/{group_id}/trips/{trip_id}/booking")
def book_trip(group_id: int, trip_id: int, account: CurrentAccount, session: DB, now: Today) -> TripOut:
    """Book PTO for every adult you manage in the group. All of them or none:
    if anyone can't go, nothing is saved."""
    group = load_group(session, group_id)  # with everyone's calendars and PTO, for the cost check
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    trip = group_trip(session, group, trip_id)
    check_not_past(trip, now)
    adults = bookable_adults(account, group)
    if not adults:
        raise HTTPException(409, "You have no adults in this group to book PTO for")

    to_book = [p for p in adults if not any(b.trip_id == trip.id for b in p.pto_blocks)]
    # Holidays through Dec 31, like the search: a December trip mustn't be charged for Christmas.
    load_end = max(trip.end_date, date(now.year, 12, 31))
    calendar_ids = {link.calendar_id for p in to_book for link in p.calendars}
    events = events_in_range(session, calendar_ids, now, load_end)
    for person in to_book:
        clash = next((
            b for b in person.pto_blocks
            if b.status is orm.PTOStatus.COMMITTED
            and b.start_date <= trip.end_date and trip.start_date <= b.end_date
        ), None)
        if clash:
            raise HTTPException(
                409, f"{person.name} already has PTO booked {clash.start_date} to {clash.end_date}"
            )
        engine_person = to_engine_person(person, now, load_end, events)
        if booking_cost(engine_person, now, trip.start_date, trip.end_date) is None:
            raise HTTPException(409, f"{person.name} doesn't have enough PTO left for this trip")

    for person in to_book:
        session.add(orm.PTOBlock(
            person_id=person.id, trip_id=trip.id, status=orm.PTOStatus.COMMITTED,
            start_date=trip.start_date, end_date=trip.end_date,
        ))
    try:
        session.commit()  # one transaction: every booking lands, or none does
    except IntegrityError as error:
        # Two requests raced past the check above. The database still refuses.
        session.rollback()
        if is_double_booking(error):
            raise HTTPException(409, "Someone already has PTO booked on some of these days") from None
        raise
    session.refresh(trip)
    return trip_out(trip, group, account)


@router.delete("/groups/{group_id}/trips/{trip_id}/booking")
def cancel_booking(group_id: int, trip_id: int, account: CurrentAccount, session: DB) -> TripOut:
    """Take back your people's PTO for this trip. The saved trip stays."""
    group = my_group(session, account, group_id)
    trip = group_trip(session, group, trip_id)
    mine = {p.id for p in bookable_adults(account, group)}
    for booking in [b for b in trip.bookings if b.person_id in mine]:
        session.delete(booking)
    session.commit()
    session.refresh(trip)
    return trip_out(trip, group, account)
