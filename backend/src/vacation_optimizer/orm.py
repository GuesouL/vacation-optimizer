"""Database tables (SQLAlchemy 2.0 ORM).

These mirror the MVP data model from the plan. The engine never sees these
classes: `loader.py` converts rows into the engine's plain dataclasses, so the
optimizer stays testable without a database.

Every date column is `Date` (Postgres `date`), never a timestamp.
"""

from datetime import date
from enum import Enum

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    Date,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
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


class Account(Base):
    """A login. Phase 2 doesn't do sign-in yet; the table is here so people can link to it."""

    __tablename__ = "account"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class Person(Base):
    """Anyone being planned for. Guests and kids don't need an Account."""

    __tablename__ = "person"
    __table_args__ = (
        CheckConstraint("pto_balance IS NULL OR pto_balance >= 0", name="pto_not_negative"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[PersonKind] = mapped_column(SAEnum(PersonKind, name="person_kind"))
    pto_balance: Mapped[int | None]  # NULL for kids
    # Weekdays they work, Mon=0 ... Sun=6. A nurse working Wed-Sun is {2,3,4,5,6}.
    work_week: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), default=lambda: [0, 1, 2, 3, 4])
    managed_by_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))
    linked_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"))

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


class CalendarEvent(Base):
    __tablename__ = "calendar_event"
    __table_args__ = (CheckConstraint("end_date >= start_date", name="event_dates_in_order"),)
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
    __table_args__ = (CheckConstraint("end_date >= start_date", name="pto_dates_in_order"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[PTOStatus] = mapped_column(SAEnum(PTOStatus, name="pto_status"))


class Group(Base):
    """A trip crew: a family, or two families planning together."""

    __tablename__ = "trip_group"  # "group" is a reserved word in SQL
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))

    members: Mapped[list["GroupMember"]] = relationship(cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_member"
    __table_args__ = (UniqueConstraint("group_id", "person_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("trip_group.id", ondelete="CASCADE"))
    person_id: Mapped[int] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"))

    person: Mapped[Person] = relationship()
