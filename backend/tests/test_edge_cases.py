"""The 12 edge cases from the Phase 0-1 kickoff plan.

Default setup unless noted: Mon-Fri worker, all 11 federal holidays,
searching the 2026-27 school year (Sep 10, 2026 - Jun 28, 2027).
"""

from datetime import date

from conftest import YEAR_END, YEAR_START

from vacation_optimizer.engine import distinct_windows, find_windows, timeline
from vacation_optimizer.holidays import federal_calendar
from vacation_optimizer.models import (
    Calendar,
    CalendarEvent,
    DayStatus,
    Effect,
    Person,
    PTOBlock,
    Window,
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

    assert alice.remaining_pto(YEAR_START) == 6
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


def test_distinct_windows_keeps_the_better_ranked_overlap():
    first = Window(date(2026, 10, 9), date(2026, 10, 12), {"A": 1})
    overlap = Window(date(2026, 10, 10), date(2026, 10, 13), {"A": 1})
    later = Window(date(2026, 11, 26), date(2026, 11, 29), {"A": 1})
    assert distinct_windows([first, overlap, later]) == [first, later]


def test_last_years_pto_does_not_come_off_this_years_balance(make_adult):
    """Booked PTO from a past year was already spent from a past balance."""
    old_trip = PTOBlock(date(2025, 12, 29), date(2025, 12, 31))  # Mon-Wed, 3 workdays
    alice = make_adult("Alice", 4, committed_pto=[old_trip])
    result = find_windows([alice], YEAR_START, YEAR_END)

    # Thanksgiving week: 4 PTO days (Mon-Wed and Fri) turn into 9 days off.
    assert find(result.windows, date(2026, 11, 21), date(2026, 11, 29)).pto_cost == {"Alice": 4}


def test_next_years_pto_comes_off_next_years_balance(make_adult):
    """The balance is 'PTO left this year'. A trip booked for next January uses next year's days."""
    next_year = PTOBlock(date(2027, 1, 4), date(2027, 1, 8))  # Mon-Fri, 5 workdays
    alice = make_adult("Alice", 4, committed_pto=[next_year])
    result = find_windows([alice], YEAR_START, YEAR_END)

    assert find(result.windows, date(2026, 11, 21), date(2026, 11, 29)).pto_cost == {"Alice": 4}


def test_holidays_inside_booked_pto_are_not_charged(make_adult):
    """HR doesn't charge PTO for Thanksgiving, so booking Mon-Fri of that week costs 4, not 5."""
    thanksgiving_week = PTOBlock(date(2026, 11, 23), date(2026, 11, 27))
    alice = make_adult("Alice", 5, committed_pto=[thanksgiving_week])
    result = find_windows([alice], YEAR_START, YEAR_END)

    # 5 - 4 = 1 day left, enough for the Friday before Columbus Day.
    assert find(result.windows, date(2026, 10, 9), date(2026, 10, 12)).pto_cost == {"Alice": 1}


# --- PTO renewal (Phase 4) -----------------------------------------------------
# Thanksgiving week 2026: 4 PTO (Mon-Wed + Fri) turns Sat Nov 21-Sun Nov 29 into 9 days.
# Presidents' Day week 2027: Tue Feb 16-Fri Feb 19 is 4 PTO for Sat Feb 13-Sun Feb 21.


def test_after_renewal_trips_use_next_years_allowance(make_adult):
    """2 days left now, but 20 arrive on Jan 1: February can afford a 4-day trip."""
    alice = make_adult("Alice", 2, pto_allowance=20)
    result = find_windows([alice], YEAR_START, YEAR_END, sort="longest", min_days=9, max_days=9)

    assert find(result.windows, date(2027, 2, 13), date(2027, 2, 21)).pto_cost == {"Alice": 4}
    assert find(result.windows, date(2026, 11, 21), date(2026, 11, 29)) is None  # this year: only 2


def test_without_an_allowance_the_old_balance_carries_on(make_adult):
    """No yearly number given: same as before, one balance for the whole search."""
    alice = make_adult("Alice", 2)
    result = find_windows([alice], YEAR_START, YEAR_END, min_days=9, max_days=9)
    assert find(result.windows, date(2027, 2, 13), date(2027, 2, 21)) is None


def test_anniversary_renewal_date(make_adult):
    """Renews Apr 1, not Jan 1: February is still this year's 2 days."""
    alice = make_adult("Alice", 2, pto_allowance=20, pto_renews_on=(4, 1))
    result = find_windows([alice], YEAR_START, YEAR_END, min_days=9, max_days=9)
    assert find(result.windows, date(2027, 2, 13), date(2027, 2, 21)) is None
    # After Apr 1 the new 20 apply: Sat May 22-Mon May 31 (Memorial Day) is 10 days for 5 PTO.
    result = find_windows([alice], YEAR_START, YEAR_END, min_days=10, max_days=10)
    assert find(result.windows, date(2027, 5, 22), date(2027, 5, 31)).pto_cost == {"Alice": 5}


def test_trip_across_renewal_splits_its_days(make_adult):
    """Winter break 2026-27: Dec 28-31 come from this year, Jan 4-8 from next year."""
    trip = (date(2026, 12, 26), date(2027, 1, 10))  # 16 days, PTO Dec 28-31 (4) + Jan 4-8 (5)
    enough = make_adult("Alice", 4, pto_allowance=5)
    assert find(find_windows([enough], YEAR_START, YEAR_END, sort="longest").windows, *trip).pto_cost == {"Alice": 9}
    short_this_year = make_adult("Alice", 3, pto_allowance=20)
    assert find(find_windows([short_this_year], YEAR_START, YEAR_END, sort="longest").windows, *trip) is None


def test_carryover_tops_up_next_year(make_adult):
    """10 left, carry up to 5: next year has allowance + 5. Without carryover it's allowance only."""
    feb = (date(2027, 2, 13), date(2027, 2, 21))  # 4 PTO
    carries = make_adult("Alice", 10, pto_allowance=3, pto_carryover_max=5)
    assert find(find_windows([carries], YEAR_START, YEAR_END, min_days=9, max_days=9).windows, *feb)
    loses_it = make_adult("Alice", 10, pto_allowance=3)
    assert find(find_windows([loses_it], YEAR_START, YEAR_END, min_days=9, max_days=9).windows, *feb) is None


def test_booked_pto_counts_against_the_year_it_falls_in(make_adult):
    """A booked January trip uses next year's allowance, not this year's balance."""
    booked = PTOBlock(date(2027, 1, 4), date(2027, 1, 8))  # 5 workdays in 2027
    alice = make_adult("Alice", 4, pto_allowance=8, committed_pto=[booked])
    result = find_windows([alice], YEAR_START, YEAR_END, min_days=9, max_days=9)
    assert find(result.windows, date(2026, 11, 21), date(2026, 11, 29)).pto_cost == {"Alice": 4}  # this year intact
    assert find(result.windows, date(2027, 2, 13), date(2027, 2, 21)) is None  # 8 - 5 = 3 left, trip needs 4


def test_a_trip_across_renewal_eats_into_its_own_carryover(make_adult):
    """6 left, 2 per year, carry up to 5. On its own, next year looks like 2 + 5 = 7.
    But this trip spends 4 of the 6 in December, so only 2 carry over: 2 + 2 = 4,
    not enough for the 5 January days."""
    trip = (date(2026, 12, 26), date(2027, 1, 10))
    alice = make_adult("Alice", 6, pto_allowance=2, pto_carryover_max=5)
    assert find(find_windows([alice], YEAR_START, YEAR_END, sort="longest").windows, *trip) is None
    richer = make_adult("Alice", 9, pto_allowance=2, pto_carryover_max=5)  # 9 - 4 = 5 carry: 2 + 5 = 7
    assert find(find_windows([richer], YEAR_START, YEAR_END, sort="longest").windows, *trip).pto_cost == {"Alice": 9}
