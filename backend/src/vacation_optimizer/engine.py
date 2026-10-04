"""The optimizer: find the best vacation windows a whole group can share.

1. Build each person's day-by-day timeline: FREE, WORK or BUSY.
2. Slide a window of every allowed length across the date range.
3. Each person's PTO cost for a window = their WORK days inside it.
4. Drop windows with a BUSY day, or that cost more than anyone has left.
5. Rank what's left.

Prefix sums make step 3 one subtraction per window instead of a day-by-day
recount, like reading two odometer readings instead of counting every mile.
"""

from datetime import date, timedelta
from itertools import accumulate
from typing import Literal

from .models import DayStatus, Effect, Person, SearchResult, Window

SortOrder = Literal["best_value", "longest"]


def timeline(person: Person, start: date, end: date) -> list[DayStatus]:
    """One status per day from start to end, inclusive."""
    free: set[date] = set()  # a set, so a day listed in two calendars counts once
    busy: set[date] = set()
    for calendar in person.calendars:
        for event in calendar.events:
            if event.title in person.excluded_events:
                continue
            target = busy if event.effect is Effect.BUSY else free
            target.update(event.days())
    for block in person.committed_pto:
        free.update(block.days())

    statuses = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        if day in busy:  # BUSY is checked first, so it beats any day off
            statuses.append(DayStatus.BUSY)
        elif day in free or day.weekday() not in person.work_week:
            statuses.append(DayStatus.FREE)
        else:
            statuses.append(DayStatus.WORK)
    return statuses


def _prefix_sums(statuses: list[DayStatus], status: DayStatus) -> list[int]:
    """sums[i] = how many of the first i days have `status`."""
    return [0, *accumulate(1 if s is status else 0 for s in statuses)]


def find_windows(
    people: list[Person],
    start: date,
    end: date,
    min_days: int = 3,
    max_days: int = 16,
    sort: SortOrder = "best_value",
) -> SearchResult:
    total_days = (end - start).days + 1
    work = {}
    busy = {}
    for person in people:
        statuses = timeline(person, start, end)
        work[person.name] = _prefix_sums(statuses, DayStatus.WORK)
        busy[person.name] = _prefix_sums(statuses, DayStatus.BUSY)

    def costs(i: int, j: int) -> dict[str, int] | None:
        """PTO cost per person for days i..j-1, or None if the window is blocked."""
        result = {}
        for person in people:
            if busy[person.name][j] - busy[person.name][i]:
                return None
            cost = work[person.name][j] - work[person.name][i]
            remaining = person.remaining_pto
            if cost > (0 if remaining is None else remaining):
                return None
            result[person.name] = cost
        return result

    def free_for_everyone(index: int) -> bool:
        if not 0 <= index < total_days:
            return False
        return all(
            work[p.name][index + 1] == work[p.name][index]
            and busy[p.name][index + 1] == busy[p.name][index]
            for p in people
        )

    windows = []
    for length in range(min_days, max_days + 1):
        for i in range(total_days - length + 1):
            j = i + length
            cost = costs(i, j)
            if cost is None:
                continue
            # Skip a window that could grow by a free day and still fit the length
            # limit: Fri-Sun of a Thanksgiving weekend is just a worse Thu-Sun.
            if length < max_days and (free_for_everyone(i - 1) or free_for_everyone(j)):
                continue
            windows.append(
                Window(start + timedelta(days=i), start + timedelta(days=j - 1), cost)
            )

    paid = [w for w in windows if w.bottleneck_cost > 0]
    free = sorted((w for w in windows if w.bottleneck_cost == 0), key=lambda w: w.start)
    if sort == "longest":
        paid.sort(key=lambda w: (-w.days, w.bottleneck_cost, w.start))
    else:
        # Ties are common, so the earliest window always wins a tie.
        paid.sort(key=lambda w: (-w.score, w.start, -w.days))

    message = None
    if not paid and not free:
        message = "No window fits everyone in this date range."
    return SearchResult(paid, free, message)


def distinct_windows(windows: list[Window]) -> list[Window]:
    """Keep each window only if it doesn't overlap a better-ranked one.

    Fri Oct 9-Mon Oct 12 and Sat Oct 10-Tue Oct 13 are the same Columbus Day
    break seen two ways. Walking the ranked list and skipping overlaps leaves
    one card per real opportunity.
    """
    kept: list[Window] = []
    for window in windows:
        if all(window.end < k.start or window.start > k.end for k in kept):
            kept.append(window)
    return kept
