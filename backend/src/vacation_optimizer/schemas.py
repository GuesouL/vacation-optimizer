"""Request and response shapes (Pydantic).

FastAPI uses these to validate input, reject bad requests with a clear 422
error, and generate the OpenAPI schema the TypeScript front end will be built from.
"""

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from . import orm
from .access import Role
from .models import Effect
from .orm import CalendarKind, LinkKind, PersonKind, PTOStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DateRange(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_order(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class RenewsOn(BaseModel):
    month: int = Field(ge=1, le=12)
    day: int = Field(ge=1, le=31)

    @model_validator(mode="after")
    def real_day(self):
        try:
            date(2028, self.month, self.day)  # a leap year, so Feb 29 is allowed
        except ValueError:
            raise ValueError(f"{self.month}/{self.day} isn't a real date") from None
        return self


# "Sam " and "Sam" look the same on screen, so spaces are trimmed before saving.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class PersonIn(BaseModel):
    name: Name
    kind: PersonKind
    pto_balance: int | None = Field(default=None, ge=0)
    work_week: list[int] = Field(default=[0, 1, 2, 3, 4], description="Mon=0 ... Sun=6")
    is_self: bool = Field(default=False, description="This person is the signed-in user")
    pto_allowance: int | None = Field(default=None, ge=0, le=365, description="PTO days granted each renewal")
    pto_renews_on: RenewsOn | None = Field(default=None, description="When PTO renews; omitted = Jan 1")
    pto_carryover_max: int | None = Field(default=None, ge=0, le=365, description="Unused days that roll over")

    @model_validator(mode="after")
    def check_person(self):
        if any(day not in range(7) for day in self.work_week):
            raise ValueError("work_week days must be 0 (Mon) through 6 (Sun)")
        if self.kind is PersonKind.ADULT and self.pto_balance is None:
            raise ValueError("adults need a pto_balance")
        if self.kind is PersonKind.CHILD and self.pto_balance is not None:
            raise ValueError("children don't have a pto_balance")
        if self.is_self and self.kind is not PersonKind.ADULT:
            raise ValueError("your own profile must be an adult")
        renewal_fields = (self.pto_allowance, self.pto_renews_on, self.pto_carryover_max)
        if self.pto_balance is None and any(f is not None for f in renewal_fields):
            raise ValueError("PTO renewal settings need a pto_balance")
        return self

    def columns(self) -> dict:
        """The fields as database columns: the renewal date splits into month and day."""
        fields = self.model_dump(exclude={"is_self", "pto_renews_on"})
        if self.pto_renews_on:
            fields |= {"pto_renewal_month": self.pto_renews_on.month, "pto_renewal_day": self.pto_renews_on.day}
        return fields


class PersonOut(ORMModel):
    id: int
    name: str
    kind: PersonKind
    pto_balance: int | None
    work_week: list[int]
    pto_allowance: int | None
    pto_renews_on: RenewsOn | None
    pto_carryover_max: int | None

    @model_validator(mode="before")
    @classmethod
    def join_renewal(cls, data):
        if isinstance(data, orm.Person):  # a database row: rebuild the renewal pair
            month, day = data.pto_renewal_month, data.pto_renewal_day
            data = {c: getattr(data, c) for c in ("id", "name", "kind", "pto_balance", "work_week",
                                                  "pto_allowance", "pto_carryover_max")}
            data["pto_renews_on"] = {"month": month, "day": day} if month else None
        return data


class CalendarIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: CalendarKind

    @model_validator(mode="after")
    def not_federal(self):
        if self.kind is CalendarKind.FEDERAL:
            raise ValueError("there is only one federal calendar, and it already exists")
        return self


class CalendarOut(ORMModel):
    id: int
    name: str
    kind: CalendarKind


class EventIn(DateRange):
    title: str = Field(min_length=1, max_length=200)
    effect: Effect


class EventOut(ORMModel):
    id: int
    title: str
    start_date: date
    end_date: date
    effect: Effect


class BulkEventsIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=500)


class PersonCalendarOut(CalendarOut):
    mine: bool  # you own it, so you can edit its dates
    enabled: bool


class IcsIn(BaseModel):
    text: str = Field(max_length=1_000_000, description="The contents of the .ics file")
    kind: CalendarKind  # what the calendar is for; steers which events are suggested

    @model_validator(mode="after")
    def not_federal(self):
        if self.kind is CalendarKind.FEDERAL:
            raise ValueError("federal holidays are computed, not imported")
        return self


class IcsEventOut(BaseModel):
    title: str
    start_date: date
    end_date: date  # inclusive
    effect: Effect  # suggested
    selected: bool  # ticked by default
    timed: bool  # had a time of day (a game or practice)


class IcsPreviewOut(BaseModel):
    events: list[IcsEventOut]
    skipped_recurring: int
    skipped_too_long: int
    skipped_invalid: int
    truncated: bool


class SubscribeIn(BaseModel):
    calendar_id: int
    excluded_titles: list[str] = []


class PTOBlockIn(DateRange):
    status: PTOStatus


class PTOBlockOut(ORMModel):
    id: int
    start_date: date
    end_date: date
    status: PTOStatus


class TripIn(DateRange):
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None

    @model_validator(mode="after")
    def not_too_long(self):
        if (self.end_date - self.start_date).days + 1 > 31:
            raise ValueError("a trip can be at most 31 days")
        return self


class TripOut(BaseModel):
    id: int
    start_date: date
    end_date: date  # inclusive
    label: str | None
    booked_by: list[str]  # names of the people who booked PTO for it
    can_book: bool  # you manage at least one adult in this group
    mine_booked: bool  # every adult you manage in this group has booked it
    can_delete: bool  # you saved it, or you own the group


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    person_ids: list[int] = Field(min_length=1)


class MemberOut(BaseModel):
    """A person in a group. Balance and work week are None unless they're yours."""

    id: int
    name: str
    kind: PersonKind
    mine: bool
    pto_balance: int | None
    work_week: list[int] | None


class GroupOut(BaseModel):
    id: int
    name: str
    role: Role
    people: list[MemberOut]


class GroupSummary(BaseModel):
    id: int
    name: str
    role: Role


class MeOut(BaseModel):
    email: str
    name: str
    self_person_id: int | None  # None until they fill in their own profile
    people: list[PersonOut]  # everyone this account can edit, themselves included
    groups: list[GroupSummary]


class WindowOut(BaseModel):
    start: date
    end: date
    days: int
    pto_cost: dict[str, int]
    score: float | None  # None for free long weekends (0 PTO, no divide by zero)


class SearchOut(BaseModel):
    windows: list[WindowOut]
    free_long_weekends: list[WindowOut]
    message: str | None


class LinkIn(BaseModel):
    kind: LinkKind


class LinkOut(BaseModel):
    id: int
    kind: LinkKind
    expires_at: datetime
    revoked: bool


class NewLinkOut(LinkOut):
    token: str  # shown once, right after creation; the server only keeps its hash


class InvitePreview(BaseModel):
    group_name: str
    invited_by: str  # first name only
    kind: LinkKind


class AcceptIn(BaseModel):
    person_ids: list[int] = Field(min_length=1)


class AddMembersIn(BaseModel):
    person_ids: list[int] = Field(min_length=1)


class SharedViewOut(BaseModel):
    group_name: str
    people: list[str]  # first names only
    search: SearchOut
