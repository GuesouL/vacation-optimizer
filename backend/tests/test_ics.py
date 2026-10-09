"""Reading .ics files: the traps (exclusive end dates, recurring events, times) and the suggestions."""

from datetime import date, timedelta

import pytest

from vacation_optimizer.ics import MAX_EVENTS_RETURNED, parse_ics
from vacation_optimizer.models import Effect
from vacation_optimizer.orm import CalendarKind


def ics(*events: str) -> str:
    body = "".join(f"BEGIN:VEVENT\r\n{e.strip()}\r\nEND:VEVENT\r\n" for e in events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n{body}END:VCALENDAR\r\n"


def parse(*events, kind=CalendarKind.SCHOOL):
    return parse_ics(ics(*events), kind)


def only(result):
    assert len(result.events) == 1
    return result.events[0]


def test_all_day_end_is_exclusive():
    """A one-day all-day event on Nov 26 is written with DTEND Nov 27. We must not block both days."""
    event = only(parse("UID:1\r\nSUMMARY:Thanksgiving\r\nDTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261127"))
    assert (event.start, event.end, event.timed) == (date(2026, 11, 26), date(2026, 11, 26), False)


def test_multi_day_all_day_event():
    event = only(parse("UID:1\r\nSUMMARY:Winter Recess\r\nDTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20270102"))
    assert (event.start, event.end) == (date(2026, 12, 24), date(2027, 1, 1))


def test_all_day_without_an_end_is_one_day():
    event = only(parse("UID:1\r\nSUMMARY:Picture day\r\nDTSTART;VALUE=DATE:20261015"))
    assert (event.start, event.end) == (date(2026, 10, 15), date(2026, 10, 15))


def test_timed_event_keeps_its_date_and_is_not_ticked():
    game = only(parse(
        "UID:1\r\nSUMMARY:Away game\r\nDTSTART:20261017T190000\r\nDTEND:20261017T210000",
        kind=CalendarKind.LEAGUE,
    ))
    assert (game.start, game.end, game.timed, game.selected) == (date(2026, 10, 17), date(2026, 10, 17), True, False)


def test_timed_event_ending_at_midnight_ends_the_day_before():
    event = only(parse("UID:1\r\nSUMMARY:Sleepaway\r\nDTSTART:20260710T090000\r\nDTEND:20260713T000000"))
    assert (event.start, event.end) == (date(2026, 7, 10), date(2026, 7, 12))


def test_recurring_events_are_counted_not_imported():
    result = parse(
        "UID:1\r\nSUMMARY:Practice\r\nDTSTART:20261006T170000\r\nDTEND:20261006T190000\r\nRRULE:FREQ=WEEKLY;BYDAY=TU",
        "UID:2\r\nSUMMARY:Tournament\r\nDTSTART;VALUE=DATE:20261107\r\nDTEND;VALUE=DATE:20261109",
        kind=CalendarKind.LEAGUE,
    )
    assert result.skipped_recurring == 1
    assert [e.title for e in result.events] == ["Tournament"]


def test_year_long_banners_are_left_out():
    result = parse("UID:1\r\nSUMMARY:2026-27 school year\r\nDTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20270903")
    assert result.events == [] and result.skipped_too_long == 1


def test_event_without_a_start_is_skipped():
    result = parse("UID:1\r\nSUMMARY:Broken")
    assert result.events == [] and result.skipped_invalid == 1


@pytest.mark.parametrize("title, effect, selected", [
    ("No School - Thanksgiving Recess", Effect.DAY_OFF, True),
    ("Spring Break", Effect.DAY_OFF, True),
    ("Labor Day", Effect.DAY_OFF, True),
    ("Report cards go home", Effect.BUSY, False),  # a school's FYI isn't something to plan around
])
def test_school_suggestions(title, effect, selected):
    event = only(parse(f"UID:1\r\nSUMMARY:{title}\r\nDTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261127"))
    assert (event.effect, event.selected) == (effect, selected)


def test_league_all_day_events_block_by_default():
    event = only(parse(
        "UID:1\r\nSUMMARY:State Tournament\r\nDTSTART;VALUE=DATE:20261107\r\nDTEND;VALUE=DATE:20261109",
        kind=CalendarKind.LEAGUE,
    ))
    assert (event.effect, event.selected) == (Effect.BUSY, True)
    assert (event.start, event.end) == (date(2026, 11, 7), date(2026, 11, 8))


def test_titles_survive_folding_and_escapes():
    text = ics("UID:1\r\nSUMMARY:No school\\, staff\r\n  development day\r\nDTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104")
    assert only(parse_ics(text, CalendarKind.SCHOOL)).title == "No school, staff development day"


def test_duplicates_are_dropped_and_results_sorted():
    result = parse(
        "UID:b\r\nSUMMARY:Spring Break\r\nDTSTART;VALUE=DATE:20270405\r\nDTEND;VALUE=DATE:20270410",
        "UID:a\r\nSUMMARY:Labor Day\r\nDTSTART;VALUE=DATE:20260907\r\nDTEND;VALUE=DATE:20260908",
        "UID:c\r\nSUMMARY:Labor Day\r\nDTSTART;VALUE=DATE:20260907\r\nDTEND;VALUE=DATE:20260908",
    )
    assert [(e.title, e.start) for e in result.events] == [("Labor Day", date(2026, 9, 7)), ("Spring Break", date(2027, 4, 5))]


def test_not_a_calendar_is_an_error():
    with pytest.raises(ValueError):
        parse_ics("this is not a calendar", CalendarKind.SCHOOL)


def test_a_calendar_with_no_events_is_fine():
    assert parse_ics(ics(), CalendarKind.CUSTOM).events == []


def test_too_many_events_are_capped():
    first = date(2026, 1, 1)
    many = [
        f"UID:{i}\r\nSUMMARY:Event {i}\r\nDTSTART;VALUE=DATE:{(first + timedelta(days=i)).strftime('%Y%m%d')}"
        for i in range(MAX_EVENTS_RETURNED + 50)
    ]
    result = parse(*many, kind=CalendarKind.CUSTOM)
    assert len(result.events) == MAX_EVENTS_RETURNED
    assert result.truncated is True
    assert result.events[0].title == "Event 0"  # the earliest are kept
