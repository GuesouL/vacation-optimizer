"""Read an .ics file (the calendar format Google Calendar, TeamSnap and most school
sites export) into candidate events for the user to review.

Nothing here touches the database: it turns text into a list of suggestions. The
user ticks what counts, and the checked rows go through the same bulk endpoint as
the typed-in form, so there is one way into storage.

Traps handled on purpose:
- An all-day event's DTEND is the day AFTER it ends (a one-day event on Mar 3 has
  DTEND Mar 4). Using it as-is would block a day too many.
- Recurring events (RRULE/RDATE, like "practice every Tuesday") aren't expanded.
  The engine works in whole days, so weekly practices shouldn't block a vacation
  week anyway. They're counted so the screen can say how many were left out.
- A timed event keeps only the date it's written with. Times and time zones are
  dropped, because the app only ever deals in plain dates.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from icalendar import Calendar

from .models import Effect
from .orm import CalendarKind

MAX_EVENTS_RETURNED = 500
MAX_SPAN_DAYS = 366  # a year-long banner like "2026-27 school year" isn't an obligation

# Titles that mean "the day is free". Lowercase; matched anywhere in the title.
DAY_OFF_WORDS = (
    "no school", "recess", "break", "holiday", "vacation", "closed", "closure", "day off",
    "staff development", "professional development", "labor day", "memorial day",
    "thanksgiving", "christmas", "new year", "independence day", "juneteenth", "columbus",
    "indigenous", "veterans", "presidents", "martin luther king", "mlk", "good friday",
    "rosh hashanah", "yom kippur", "eid", "diwali", "lunar new year",
)


@dataclass
class Candidate:
    title: str
    start: date
    end: date  # inclusive
    effect: Effect
    selected: bool  # ticked by default
    timed: bool  # had a time of day (a game or practice), not an all-day entry


@dataclass
class IcsResult:
    events: list[Candidate]
    skipped_recurring: int = 0
    skipped_too_long: int = 0
    skipped_invalid: int = 0
    truncated: bool = False


def suggest(title: str, kind: CalendarKind, timed: bool) -> tuple[Effect, bool]:
    """Guess the effect and whether to tick it. The user always has the last word.

    Title says "no school" / "holiday": a day off, ticked. Anything else blocks the
    day (the cautious direction), and is ticked only if it's all-day and the calendar
    isn't a school's (a school's "report cards due" isn't something to plan around).
    Timed events are never ticked: a 7pm game doesn't block a whole vacation.
    """
    lowered = title.lower()
    if any(word in lowered for word in DAY_OFF_WORDS):
        return Effect.DAY_OFF, not timed
    return Effect.BUSY, not timed and kind is not CalendarKind.SCHOOL


def _as_date(value: date | datetime) -> date:
    return value.date() if isinstance(value, datetime) else value


def _span(component) -> tuple[date, date, bool]:
    """(first day, last day inclusive, has a time of day) for one VEVENT."""
    raw_start = component.decoded("DTSTART")
    timed = isinstance(raw_start, datetime)
    start = _as_date(raw_start)

    if component.get("DTEND") is not None:
        raw_end = component.decoded("DTEND")
        end = _as_date(raw_end)
        if timed:
            # Ends at exactly midnight means the previous day was the last one.
            if isinstance(raw_end, datetime) and raw_end.time() == time(0, 0) and end > start:
                end -= timedelta(days=1)
        else:
            end -= timedelta(days=1)  # all-day DTEND is exclusive
    elif component.get("DURATION") is not None:
        length = component.decoded("DURATION")
        end = _as_date(raw_start + length)
        if not timed and length >= timedelta(days=1):
            end -= timedelta(days=1)
    else:
        end = start
    return start, max(end, start), timed


def parse_ics(text: str, kind: CalendarKind) -> IcsResult:
    """Raises ValueError when the text isn't a calendar at all."""
    try:
        calendar = Calendar.from_ical(text)
    except Exception as error:  # the library raises several types for bad input
        raise ValueError("That doesn't look like an .ics calendar file") from error

    result = IcsResult(events=[])
    seen: set[tuple[str, date, date]] = set()
    for component in calendar.walk("VEVENT"):
        if component.get("RRULE") is not None or component.get("RDATE") is not None:
            result.skipped_recurring += 1
            continue
        try:
            start, end, timed = _span(component)
        except (KeyError, ValueError, TypeError, OverflowError):
            result.skipped_invalid += 1
            continue
        if (end - start).days + 1 > MAX_SPAN_DAYS:
            result.skipped_too_long += 1
            continue
        title = " ".join(str(component.get("SUMMARY", "")).split())[:200] or "Untitled"
        if (title, start, end) in seen:
            continue
        seen.add((title, start, end))
        effect, selected = suggest(title, kind, timed)
        result.events.append(Candidate(title, start, end, effect, selected, timed))

    result.events.sort(key=lambda c: (c.start, c.end, c.title))
    if len(result.events) > MAX_EVENTS_RETURNED:
        result.events = result.events[:MAX_EVENTS_RETURNED]
        result.truncated = True
    return result
