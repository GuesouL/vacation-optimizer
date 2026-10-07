"""Request and response shapes (Pydantic).

FastAPI uses these to validate input, reject bad requests with a clear 422
error, and generate the OpenAPI schema the TypeScript front end will be built from.
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: PersonKind
    pto_balance: int | None = Field(default=None, ge=0)
    work_week: list[int] = Field(default=[0, 1, 2, 3, 4], description="Mon=0 ... Sun=6")
    is_self: bool = Field(default=False, description="This person is the signed-in user")

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
        return self


class PersonOut(ORMModel):
    id: int
    name: str
    kind: PersonKind
    pto_balance: int | None
    work_week: list[int]


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


class SharedViewOut(BaseModel):
    group_name: str
    people: list[str]  # first names only
    search: SearchOut
