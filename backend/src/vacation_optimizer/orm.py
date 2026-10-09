"""Database tables (SQLAlchemy 2.0 ORM).

These mirror the MVP data model from the plan. The engine never sees these
classes: `loader.py` converts rows into the engine's plain dataclasses, so the
optimizer stays testable without a database.

Every date column is `Date` (Postgres `date`), never a timestamp.
"""

from datetime import date, datetime
from enum import Enum

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    literal_column,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .models import Effect


class Base(DeclarativeBase):
    pass


class PersonKind(Enum):
    ADULT = "ADULT"
    CHILD = "CHILD"
    GUEST = "GUEST"


class CalendarKind(Enum):
    FEDERAL = "FEDERAL"  # no stored events: dates come from the rule function
    WORK = "WORK"
    SCHOOL = "SCHOOL"
    LEAGUE = "LEAGUE"
    CUSTOM = "CUSTOM"


class PTOStatus(Enum):
    PROPOSED = "PROPOSED"
    COMMITTED = "COMMITTED"


class LinkKind(Enum):
    INVITE = "INVITE"  # join the group (needs an account)
    VIEW = "VIEW"  # read-only: first names and dates, no account needed


class Account(Base):
    """A login. Created on someone's first signed-in request (see auth.py)."""

    __tablename__ = "account"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class Person(Base):
    """Anyone being planned for. Guests and kids don't need an Account."""

    __tablename__ = "person"
    __table_args__ = (
        CheckConstraint("pto_balance IS NULL OR pto_balance >= 0", name="pto_not_negative"),
        CheckConstraint("pto_allowance IS NULL OR pto_allowance >= 0", name="allowance_not_negative"),
        CheckConstraint("pto_carryover_max IS NULL OR pto_carryover_max >= 0", name="carryover_not_negative"),
        # Month and day of the renewal come as a pair, or not at all (NULL = Jan 1).
        CheckConstraint(
            "(pto_renewal_month IS NULL) = (pto_renewal_day IS NULL)", name="renewal_month_and_day"
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[PersonKind] = mapped_column(SAEnum(PersonKind, name="person_kind"))
    pto_balance: Mapped[int | None]  # NULL for kids
    # PTO renewal (all optional). Month/day, not a full date, because it repeats
    # every year; a stored "next renewal" date would go stale the day it passed.
    pto_allowance: Mapped[int | None]  # days granted at each renewal
    pto_renewal_month: Mapped[int | None] = mapped_column(SmallInteger)
    pto_renewal_day: Mapped[int | None] = mapped_column(SmallInteger)
    pto_carryover_max: Mapped[int | None]  # NULL or 0 = use it or lose it
    # Weekdays they work, Mon=0 ... Sun=6. A nurse working Wed-Sun is {2,3,4,5,6}.
    work_week: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=lambda: [0, 1, 2, 3, 4])
    # Who can edit this person: the account that added them (a parent adding a
    # kid), and the person's own account once they sign up.
    managed_by_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), index=True)
    linked_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), index=True)

    calendars: Mapped[list["PersonCalendar"]] = relationship(cascade="all, delete-orphan")
    pto_blocks: Mapped[list["PTOBlock"]] = relationship(cascade="all, delete-orphan")


class Calendar(Base):
    """A reusable set of dates, like 'NYC Public Schools 2026-27', shared by many people."""

    __tablename__ = "calendar"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[CalendarKind] = mapped_column(SAEnum(CalendarKind, name="calendar_kind"))
    owner_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))  # NULL = shared

    events: Mapped[list["CalendarEvent"]] = relationship(
        cascade="all, delete-orphan", order_by="CalendarEvent.start_date"
    )


def date_span(start, end):
    """A Postgres `daterange` that includes both ends: '[]' means closed on both sides.

    Written exactly like the index below. If the two ever differ (say '[)' here),
    Postgres can't use the index for the dates and falls back to checking them row by row.
    """
    return func.daterange(start, end, literal_column("'[]'"))


class CalendarEvent(Base):
    __tablename__ = "calendar_event"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="event_dates_in_order"),
        # A GiST index answers "which events overlap these dates?" without reading
        # every row. btree_gist lets plain calendar_id sit in the same index.
        Index(
            "ix_calendar_event_calendar_dates",
            "calendar_id",
            text("daterange(start_date, end_date, '[]')"),
            postgresql_using="gist",
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    calendar_id: Mapped[int] = mapped_column(ForeignKey("calendar.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)  # inclusive
    effect: Mapped[Effect] = mapped_column(SAEnum(Effect, name="event_effect"))


class PersonCalendar(Base):
    """The on/off switch linking a person to a calendar."""

    __tablename__ = "person_calendar"
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), primary_key=True)
    calendar_id: Mapped[int] = mapped_column(ForeignKey("calendar.id", ondelete="CASCADE"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(default=True)
    # Event titles this person doesn't get, e.g. ["Columbus Day"].
    excluded_titles: Mapped[list[str]] = mapped_column(ARRAY(String(200)), default=list)

    calendar: Mapped[Calendar] = relationship()


class PTOBlock(Base):
    __tablename__ = "pto_block"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="pto_dates_in_order"),
        # One person can't book the same day twice: that would charge their PTO
        # twice. The database enforces it, so no code path (or race) can slip
        # past. PROPOSED blocks are only ideas, so they may overlap.
        ExcludeConstraint(
            ("person_id", "="),
            (text("daterange(start_date, end_date, '[]')"), "&&"),
            name="no_double_booked_pto",
            using="gist",
            where=text("status = 'COMMITTED'"),
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[PTOStatus] = mapped_column(SAEnum(PTOStatus, name="pto_status"))
    # Set when this booking is someone's share of a group trip. Deleting the
    # trip deletes the bookings with it.
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trip.id", ondelete="CASCADE"), index=True)


class Group(Base):
    """A trip crew: a family, or two families planning together."""

    __tablename__ = "trip_group"  # "group" is a reserved word in SQL
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # NULL only for groups made before sign-in existed; nobody can open those.
    owner_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), index=True)

    members: Mapped[list["GroupMember"]] = relationship(cascade="all, delete-orphan")


class Trip(Base):
    """Dates a group saved from the plan. A saved trip is just an idea until people
    book it: each adult's booking is their own COMMITTED pto_block pointing here."""

    __tablename__ = "trip"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="trip_dates_in_order"),
        UniqueConstraint("group_id", "start_date", "end_date", name="one_trip_per_dates"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("trip_group.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)  # inclusive
    label: Mapped[str | None] = mapped_column(String(100))
    created_by_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id", ondelete="SET NULL"))

    bookings: Mapped[list[PTOBlock]] = relationship(passive_deletes=True)


class GroupMember(Base):
    __tablename__ = "group_member"
    __table_args__ = (UniqueConstraint("group_id", "person_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("trip_group.id", ondelete="CASCADE"))
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"))

    person: Mapped[Person] = relationship()


class ShareLink(Base):
    """A secret link to a group. Only a hash of the token is stored, the same way
    passwords are: a leaked database backup can't be turned back into working links."""

    __tablename__ = "share_link"
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("trip_group.id", ondelete="CASCADE"), index=True)
    kind: Mapped[LinkKind] = mapped_column(SAEnum(LinkKind, name="link_kind"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256, hex
    created_by_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    # Expiry is a moment in time, not a calendar day, so this one column is a
    # timestamp with a time zone. Every planning date stays a plain `date`.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    group: Mapped[Group] = relationship()
