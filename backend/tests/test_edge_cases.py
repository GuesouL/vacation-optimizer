"""The 12 edge cases from the Phase 0-1 kickoff plan.

Default setup unless noted: Mon-Fri worker, all 11 federal holidays,
searching the 2026-27 school year (Sep 10, 2026 - Jun 28, 2027).
"""

from datetime import date

from conftest import YEAR_END, YEAR_START

from vacation_optimizer.engine import find_windows, timeline
from vacation_optimizer.holidays import federal_calendar
from vacation_optimizer.models import (
    Calendar,
    CalendarEvent,
    DayStatus,
    Effect,
    Person,
    PTOBlock,
)


def find(windows, start, end):
    return next((w for w in windows if (w.start, w.end) == (start, end)), None)


def cost_of(person, start, end):
    """One person's PTO cost for a single window."""
    return sum(1 for s in timeline(person, start, end) if s is DayStatus.WORK)


def test_01_baseline(make_adult):
    solo = make_adult("Solo", 1)
    result = find_windows([solo], YEAR_START, YEAR_END)

    thanksgiving = find(result.windows, date(2026, 11, 26), date(2026, 11, 29))
    assert thanksgiving.days == 4
    assert thanksgiving.score == 4.0
    # 4.0 is the best score, but it's a tie: Columbus weekend (Fri Oct 9 PTO)
    # scores 4.0 too and comes first under the earliest-wins tie-break.
    assert result.windows[0].score == 4.0
    assert (result.windows[0].start, result.windows[0].end) == (date(2026, 10, 9), date(2026, 10, 12))


def test_02_ties_everywhere(make_adult):
    people = [make_adult("Alice", 10), make_adult("Bob", 5)]
    result = find_windows(people, YEAR_START, YEAR_END, min_days=9, max_days=9)

    cheapest = [w for w in result.windows if w.bottleneck_cost == 4]
    assert [w.start for w in cheapest] == [
        date(2026, 10, 10),  # Columbus
        date(2026, 11, 7),  # Veterans
        date(2026, 11, 21),  # Thanksgiving
        date(2026, 12, 19),  # Christmas
        date(2026, 12, 25),  # Christmas + New Year's
        date(2026, 12, 26),  # New Year's
        date(2027, 1, 16),  # MLK
        date(2027, 2, 13),  # Presidents
        date(2027, 5, 29),  # Memorial
        date(2027, 6, 12),  # Juneteenth
    ]
    # A fixed tie-break means the same answer on every run.
    rerun = find_windows(people, YEAR_START, YEAR_END, min_days=9, max_days=9)
    assert rerun.windows == result.windows


def test_03_bottleneck(make_adult):
    alice, bob = make_adult("Alice", 10), make_adult("Bob", 5)
    result = find_windows([alice, bob], YEAR_START, YEAR_END, sort="longest")

    longest = result.windows[0]
    assert (longest.start, longest.end) == (date(2026, 12, 24), date(2027, 1, 3))
    assert longest.days == 11
    assert longest.pto_cost == {"Alice": 5, "Bob": 5}  # Bob's 5 caps it; Alice has 5 left


def test_04_zero_pto(make_adult):
    broke = make_adult("Broke", 0)
    result = find_windows([broke], YEAR_START, YEAR_END)

    assert result.windows == []
    assert result.message is None  # free weekends exist, so no error
    starts = [w.start for w in result.free_long_weekends]
    assert date(2026, 10, 10) in starts  # Columbus
    assert date(2027, 1, 16) in starts  # MLK
    assert date(2027, 5, 29) in starts  # Memorial


def test_05_odd_work_week(make_adult):
    nurse = make_adult("Nurse", 1, work_week=frozenset({2, 3, 4, 5, 6}))  # Wed-Sun

    # Thanksgiving Thu is free, but Fri-Sun are workdays for her.
    assert cost_of(nurse, date(2026, 11, 26), date(2026, 11, 27)) == 1  # Thu-Fri: 2 days
    assert cost_of(nurse, date(2026, 11, 26), date(2026, 11, 29)) == 3  # not 1


def test_06_year_boundary():
    # Ask for 2027's holidays only: the generator must still include Dec 31, 2027.
    worker = Person("Worker", 10, calendars=[federal_calendar(date(2027, 1, 1), date(2027, 12, 31))])
    # Dec 24 (Christmas observed) and Dec 31 (New Year's 2028 observed) are free.
    assert cost_of(worker, date(2027, 12, 24), date(2028, 1, 2)) == 4


def test_07_leap_day(make_adult):
    worker = make_adult("Worker", 10)
    result = find_windows([worker], date(2028, 2, 1), date(2028, 3, 31), max_days=9)

    window = find(result.windows, date(2028, 2, 26), date(2028, 3, 5))
    assert window.days == 9  # includes Feb 29
    assert window.bottleneck_cost == 5


def test_08_busy_beats_holiday(federal, make_adult):
    tournament = Calendar(
        "Soccer league",
        [CalendarEvent(date(2027, 5, 29), date(2027, 5, 31), Effect.BUSY, "Tournament")],
    )
    parent = make_adult("Parent", 0)
    kid = Person("Kid", None, calendars=[federal, tournament])
    memorial = (date(2027, 5, 29), date(2027, 5, 31))

    result = find_windows([parent, kid], date(2027, 5, 1), date(2027, 6, 15))
    assert find(result.free_long_weekends, *memorial) is None

    # Control: without the tournament, Memorial Day weekend is offered.
    kid.calendars = [federal]
    result = find_windows([parent, kid], date(2027, 5, 1), date(2027, 6, 15))
    assert find(result.free_long_weekends, *memorial) is not None


def test_09_already_booked(make_adult):
    alice = make_adult("Alice", 10, committed_pto=[PTOBlock(date(2026, 12, 28), date(2026, 12, 31))])

    assert alice.remaining_pto == 6
    assert cost_of(alice, date(2026, 12, 26), date(2027, 1, 3)) == 0
    unbooked = make_adult("Alice", 10)
    assert cost_of(unbooked, date(2026, 12, 26), date(2027, 1, 3)) == 4


def test_10_employer_opt_out(make_adult):
    alice = make_adult("Alice", 10)
    bob = make_adult("Bob", 10, excluded_events={"Columbus Day", "Veterans Day"})
    result = find_windows([alice, bob], YEAR_START, YEAR_END)

    window = find(result.windows, date(2026, 10, 10), date(2026, 10, 12))
    assert window.pto_cost == {"Alice": 0, "Bob": 1}


def test_11_no_overlap_possible(federal):
    nyc = Calendar("NYC Public Schools 2026-27", [
        CalendarEvent(date(2027, 3, 9), date(2027, 3, 9), Effect.DAY_OFF, "Eid al-Fitr"),
        CalendarEvent(date(2027, 3, 26), date(2027, 3, 26), Effect.DAY_OFF, "Good Friday"),
        CalendarEvent(date(2027, 4, 22), date(2027, 4, 30), Effect.DAY_OFF, "Spring Recess"),
        CalendarEvent(date(2027, 5, 17), date(2027, 5, 17), Effect.DAY_OFF, "Eid al-Adha"),
    ])
    other = Calendar("Other school", [
        CalendarEvent(date(2027, 3, 22), date(2027, 3, 26), Effect.DAY_OFF, "Spring Break"),
    ])
    nyc_kid = Person("NYC kid", None, calendars=[federal, nyc])
    other_kid = Person("Other kid", None, calendars=[federal, other])

    result = find_windows([nyc_kid, other_kid], date(2027, 3, 1), date(2027, 5, 15), min_days=5)
    assert result.windows == []
    assert result.free_long_weekends == []
    assert result.message == "No window fits everyone in this date range."


def test_12_duplicate_dates(federal, make_adult):
    work = Calendar("Work", [
        CalendarEvent(date(2026, 11, 26), date(2026, 11, 26), Effect.DAY_OFF, "Thanksgiving"),
    ])
    worker = make_adult("Worker", 1, calendars=[work])
    result = find_windows([worker], date(2026, 11, 1), date(2026, 11, 30))

    thanksgiving = find(result.windows, date(2026, 11, 26), date(2026, 11, 29))
    assert thanksgiving.bottleneck_cost == 1  # counted once, so still 1 PTO, not 0 or -1
