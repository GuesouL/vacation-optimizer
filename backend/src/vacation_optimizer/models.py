"""Plain data types the engine works with.

These are dataclasses, not database models: the engine is pure logic that
takes people and calendars in and gives ranked windows back. The database
(Phase 2) and the API layer convert to and from these.
Every date is a plain `date`, never a timestamp, so time zones can't shift it.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from enum import Enum

MON_TO_FRI = frozenset(range(5))  # date.weekday(): Mon=0 ... Sun=6


class Effect(Enum):
    DAY_OFF = "DAY_OFF"  # a holiday or school break: frees the day
    BUSY = "BUSY"  # a tournament or finals week: blocks the day, always wins


class DayStatus(Enum):
    FREE = "FREE"
    WORK = "WORK"
    BUSY = "BUSY"


@dataclass(frozen=True)
class CalendarEvent:
    start: date
    end: date  # inclusive
    effect: Effect
    title: str = ""

    def days(self):
        day = self.start
        while day <= self.end:
            yield day
            day += timedelta(days=1)


@dataclass
class Calendar:
    name: str
    events: list[CalendarEvent] = field(default_factory=list)


@dataclass(frozen=True)
class PTOBlock:
    """PTO a person already booked. Its days count as free and come off the balance."""

    start: date
    end: date  # inclusive

    def days(self):
        return CalendarEvent(self.start, self.end, Effect.DAY_OFF).days()


@dataclass
class Person:
    name: str
    # None means this person can't take PTO (a kid): every window must be free for them.
    pto_balance: int | None
    work_week: frozenset[int] = MON_TO_FRI
    calendars: list[Calendar] = field(default_factory=list)
    # Event titles this person doesn't get, e.g. {"Columbus Day"} if their job skips it.
    excluded_events: set[str] = field(default_factory=set)
    committed_pto: list[PTOBlock] = field(default_factory=list)

    def days_off(self) -> set[date]:
        """Holidays and breaks this person gets, minus the ones their job skips."""
        return {
            day
            for calendar in self.calendars
            for event in calendar.events
            if event.effect is Effect.DAY_OFF and event.title not in self.excluded_events
            for day in event.days()
        }

    def remaining_pto(self, as_of: date) -> int | None:
        """PTO left for the rest of `as_of`'s year, after trips already booked.

        `pto_balance` is "days left this year", so only booked days from `as_of`
        through Dec 31 come off it: earlier trips were already spent from it, and
        next year's trips come out of next year's days. A holiday or weekend
        inside a booked trip costs nothing, same as on a real timesheet.
        """
        if self.pto_balance is None:
            return None
        year_end = date(as_of.year, 12, 31)
        holidays = self.days_off()
        booked = {
            day
            for block in self.committed_pto
            for day in block.days()
            if as_of <= day <= year_end
        }
        charged = [d for d in booked if d.weekday() in self.work_week and d not in holidays]
        return self.pto_balance - len(charged)


@dataclass(frozen=True)
class Window:
    start: date
    end: date  # inclusive
    pto_cost: dict[str, int]  # PTO each person must spend

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def bottleneck_cost(self) -> int:
        """The most PTO anyone has to spend. That person decides if the trip happens."""
        return max(self.pto_cost.values(), default=0)

    @property
    def score(self) -> float:
        """Days off per PTO day. Only defined for windows that cost PTO."""
        return self.days / self.bottleneck_cost


@dataclass
class SearchResult:
    windows: list[Window]  # cost PTO, ranked
    free_long_weekends: list[Window]  # cost nobody any PTO, earliest first
    message: str | None = None
