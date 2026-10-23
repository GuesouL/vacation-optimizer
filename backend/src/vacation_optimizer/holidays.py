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


# The names a person can say their job skips. Saved skips are matched by name,
# so renaming a holiday above would quietly undo them: add a data migration too.
FEDERAL_HOLIDAY_NAMES = tuple(name for _, name in federal_holidays(2000))


def federal_calendar(start: date, end: date) -> Calendar:
    """Every observed federal holiday between start and end, inclusive."""
    return Calendar("US Federal Holidays", _between(federal_holidays, start, end))


def before_the_holiday(day: date, holiday: date) -> date:
    """An eve that lands on a weekend, or on the day the holiday itself is
    observed, moves back to the workday before. Christmas 2027 is a Saturday,
    observed Friday Dec 24, so Christmas Eve is taken Thursday Dec 23."""
    while day.weekday() in (SAT, SUN) or day == holiday:
        day -= timedelta(days=1)
    return day


def company_days(year: int) -> list[tuple[date, str]]:
    """Days many private employers give on top of (or instead of) some federal
    holidays. Not a law anywhere: each person ticks the ones their job gives."""
    return [
        (nth_weekday(year, 11, THU, 4) + timedelta(days=1), "Day after Thanksgiving"),
        (before_the_holiday(date(year, 12, 24), observed(date(year, 12, 25))), "Christmas Eve"),
        (before_the_holiday(date(year, 12, 31), observed(date(year + 1, 1, 1))), "New Year's Eve"),
    ]


# Picks are stored as the days a person *doesn't* get (like federal skips), so a
# day added here later would switch on for everyone already subscribed: add it
# to their excluded_titles in the same data migration.
COMPANY_DAY_NAMES = tuple(name for _, name in company_days(2000))


def company_calendar(start: date, end: date) -> Calendar:
    """Every common company day between start and end, inclusive."""
    return Calendar("Common company days", _between(company_days, start, end))


def _between(rule, start: date, end: date) -> list[CalendarEvent]:
    """A rule's days between start and end. Always generates one year past `end`,
    so a next-year holiday observed in late December (New Year's 2028 -> Dec 31,
    2027) isn't missed."""
    return [
        CalendarEvent(day, day, Effect.DAY_OFF, name)
        for year in range(start.year, end.year + 2)
        for day, name in rule(year)
        if start <= day <= end
    ]
