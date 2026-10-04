"""US federal holidays, computed from rules instead of fetched from an API.

Every holiday is either a fixed date (Jul 4) that shifts to Friday or Monday
when it lands on a weekend, or a set weekday (4th Thursday of November).
We store the *observed* date, because that's the day people actually get off.
"""

from datetime import date, timedelta

from .models import Calendar, CalendarEvent, Effect

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The nth `weekday` of a month, e.g. 4th Thursday of November."""
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def last_weekday(year: int, month: int, weekday: int) -> date:
    """The last `weekday` of a month, e.g. last Monday of May."""
    next_month = date(year + month // 12, month % 12 + 1, 1)
    last = next_month - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def observed(day: date) -> date:
    """Saturday holidays are observed Friday; Sunday holidays on Monday."""
    if day.weekday() == SAT:
        return day - timedelta(days=1)
    if day.weekday() == SUN:
        return day + timedelta(days=1)
    return day


def federal_holidays(year: int) -> list[tuple[date, str]]:
    """The 11 federal holidays whose *actual* date falls in `year`, as observed.

    Note: the observed date can land in the previous year. Jan 1, 2028 is a
    Saturday, so it's observed Fri Dec 31, 2027 and appears in year=2028's list.
    """
    return [
        (observed(date(year, 1, 1)), "New Year's Day"),
        (nth_weekday(year, 1, MON, 3), "Martin Luther King Jr. Day"),
        (nth_weekday(year, 2, MON, 3), "Presidents Day"),
        (last_weekday(year, 5, MON), "Memorial Day"),
        (observed(date(year, 6, 19)), "Juneteenth"),
        (observed(date(year, 7, 4)), "Independence Day"),
        (nth_weekday(year, 9, MON, 1), "Labor Day"),
        (nth_weekday(year, 10, MON, 2), "Columbus Day"),
        (observed(date(year, 11, 11)), "Veterans Day"),
        (nth_weekday(year, 11, THU, 4), "Thanksgiving"),
        (observed(date(year, 12, 25)), "Christmas Day"),
    ]


def federal_calendar(start: date, end: date) -> Calendar:
    """Every observed federal holiday between start and end, inclusive.

    Always generates one year past `end`, so a next-year holiday observed in
    late December (New Year's 2028 -> Dec 31, 2027) isn't missed.
    """
    events = [
        CalendarEvent(day, day, Effect.DAY_OFF, name)
        for year in range(start.year, end.year + 2)
        for day, name in federal_holidays(year)
        if start <= day <= end
    ]
    return Calendar("US Federal Holidays", events)
