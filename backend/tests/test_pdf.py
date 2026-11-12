"""PDF school calendars: free text reading, the AI fallback, the cache, the limits, and half days."""

import base64
from datetime import date

import anthropic
import httpx
import pytest

from vacation_optimizer import pdf_calendar, pdf_preview
from vacation_optimizer.engine import timeline
from vacation_optimizer.ics import suggest
from vacation_optimizer.models import Calendar, CalendarEvent, DayStatus, Effect, Person
from vacation_optimizer.orm import CalendarKind
from vacation_optimizer.pdf_calendar import (
    AiCalendar,
    AiEvent,
    from_ai,
    looks_complete,
    open_pdf,
    parse_text,
)

# A school calendar written out in sentences, the way Word or Excel exports often are.
TEXT_CALENDAR = [
    "Springfield Public Schools 2026-2027 Calendar",
    "September 2 - First day of school",
    "Labor Day: September 7",
    "Yom Kippur - September 21st",
    "Thanksgiving Recess November 26-27",
    "Winter Recess: December 24, 2026 - January 1, 2027",
    "Martin Luther King Jr. Day January 18",
    "Mid-Winter Recess February 15 through 19",
    "Spring Recess April 19 - April 23",
    "Memorial Day May 31",
    "June 10 - Half day for students",
]


def make_pdf(lines: list[str]) -> bytes:
    """A real one-page PDF with these lines of text, built by hand (no PDF library needed)."""
    def escape(text):
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stream = "BT /F1 10 Tf 40 760 Td 14 TL " + " ".join(f"({escape(line)}) '" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def upload(client, data: bytes, kind="SCHOOL"):
    return client.post("/calendars/pdf-preview", json={"data_base64": base64.b64encode(data).decode(), "kind": kind})


@pytest.fixture
def claude(monkeypatch):
    """Stand in for the real API: no network, no bill. Records how often it was asked."""
    calls = []
    answer = AiCalendar(events=[
        AiEvent(title="Winter Recess", start="2026-12-24", end="2026-12-31", no_school=True),
        AiEvent(title="Half day (elementary)", start="2026-11-25", end="2026-11-25", no_school=False),
        AiEvent(title="Bad date", start="2026-02-30", end="2026-02-30", no_school=True),
        AiEvent(title="Backwards", start="2027-01-05", end="2027-01-01", no_school=True),
    ])

    def fake(data):
        calls.append(data)
        return answer

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(pdf_preview, "ask_claude", fake)
    return calls


# --- Reading text ---------------------------------------------------------


def test_text_calendar_is_read_for_free():
    _, text = open_pdf(make_pdf(TEXT_CALENDAR))
    found = {(c.title, c.start, c.end): c for c in parse_text(text)}
    winter = found[("Winter Recess", date(2026, 12, 24), date(2027, 1, 1))]
    assert winter.effect is Effect.DAY_OFF and winter.selected
    # Spring months land in the second year of the school year.
    assert ("Mid-Winter Recess", date(2027, 2, 15), date(2027, 2, 19)) in found
    assert ("Thanksgiving Recess", date(2026, 11, 26), date(2026, 11, 27)) in found
    assert found[("Half day for students", date(2027, 6, 10), date(2027, 6, 10))].effect is Effect.NOTE
    assert found[("First day of school", date(2026, 9, 2), date(2026, 9, 2))].effect is Effect.NOTE
    assert looks_complete(list(found.values()))


def test_text_without_breaks_is_not_trusted():
    # Footnotes alone (like Patchogue-Medford's) read fine but miss the breaks in the grid.
    text = "2026-2027 calendar\nNovember 3rd - Election Day - No school for students\nDecember 4 - Conference day, no school"
    found = parse_text(text)
    assert len(found) == 2
    assert not looks_complete(found)


def test_year_numbers_are_not_read_as_days():
    assert parse_text("2026-27\nSeptember 2026\nOctober 2026") == []


def test_no_school_year_means_no_guessing():
    assert parse_text("Winter Recess: December 24 - December 31") == []


# --- The endpoint ---------------------------------------------------------


def test_text_pdf_is_read_free_then_cached(client, claude):
    first = upload(client, make_pdf(TEXT_CALENDAR)).json()
    assert first["method"] == "TEXT"
    assert any(e["title"] == "Winter Recess" for e in first["events"])
    again = upload(client, make_pdf(TEXT_CALENDAR)).json()
    assert again["method"] == "CACHE"
    assert again["events"] == first["events"]
    assert claude == []  # the AI was never asked


def test_scan_goes_to_ai_once(client, claude):
    scan = make_pdf(["2026-2027", "(the dates are in a picture)"])
    result = upload(client, scan).json()
    assert result["method"] == "AI"
    events = {e["title"]: e for e in result["events"]}
    assert events["Winter Recess"]["effect"] == "DAY_OFF" and events["Winter Recess"]["selected"]
    assert events["Half day (elementary)"]["effect"] == "NOTE"  # school is open: a note, not a day off
    assert "Bad date" not in events and "Backwards" not in events
    # A second family with the same file costs nothing.
    assert upload(client, scan).json()["method"] == "CACHE"
    assert len(claude) == 1


def test_without_a_key_the_text_is_offered_with_a_note(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = upload(client, make_pdf(["2026-2027", "November 3 - Election Day, no school"])).json()
    assert result["method"] == "TEXT"
    assert [e["title"] for e in result["events"]] == ["Election Day, no school"]
    assert "isn't switched on" in result["note"]


def test_daily_limit_stops_ai_reads(client, claude, monkeypatch):
    monkeypatch.setenv("PDF_AI_DAILY_PER_ACCOUNT", "1")
    assert upload(client, make_pdf(["2026-27", "scan one"])).json()["method"] == "AI"
    second = upload(client, make_pdf(["2026-27", "scan two"])).json()
    assert second["method"] == "NONE"
    assert "today's limit" in second["note"]
    assert len(claude) == 1


def test_monthly_limit_stops_ai_reads_for_everyone(client, claude, monkeypatch):
    monkeypatch.setenv("PDF_AI_MONTHLY_LIMIT", "0")
    assert "paused" in upload(client, make_pdf(["2026-27", "scan"])).json()["note"]
    assert claude == []


def test_ai_is_for_school_calendars_only(client, claude):
    result = upload(client, make_pdf(["2026-27", "game schedule"]), kind="LEAGUE").json()
    assert result["method"] == "NONE" and claude == []


def test_bad_uploads_are_refused(client):
    assert upload(client, b"just some text").status_code == 422
    assert upload(client, b"%PDF-1.4 broken").status_code == 422
    assert client.post("/calendars/pdf-preview", json={"data_base64": "not base64!", "kind": "SCHOOL"}).status_code == 422
    assert upload(client, make_pdf(["x"]), kind="FEDERAL").status_code == 422


def test_from_ai_merges_duplicates():
    twice = AiEvent(title="Labor Day", start="2026-09-07", end="2026-09-07", no_school=True)
    assert len(from_ai(AiCalendar(events=[twice, twice]))) == 1


# --- Half days ------------------------------------------------------------


def test_half_day_notes_never_change_trip_math():
    day = date(2026, 11, 25)  # a Wednesday
    note = CalendarEvent(day, day, Effect.NOTE, "Half day")
    kid = Person("Kid", None, calendars=[Calendar("School", [note])])
    assert timeline(kid, day, day) == [DayStatus.WORK]  # still a school day


def test_ics_titles_suggest_notes_for_school_calendars():
    assert suggest("Half Day - Parent Conferences", CalendarKind.SCHOOL, timed=False) == (Effect.NOTE, True)
    assert suggest("Early dismissal before Thanksgiving", CalendarKind.SCHOOL, timed=False) == (Effect.NOTE, True)
    assert suggest("Thanksgiving Recess", CalendarKind.SCHOOL, timed=False) == (Effect.DAY_OFF, True)
    assert suggest("Half day", CalendarKind.LEAGUE, timed=False)[0] is not Effect.NOTE


def test_notes_can_be_saved_and_shown(client):
    kid = client.post("/people", json={"name": "Kid", "kind": "CHILD"}).json()["id"]
    calendar = client.post("/calendars", json={"name": "Kid's school", "kind": "SCHOOL"}).json()["id"]
    assert client.post(f"/people/{kid}/calendars", json={"calendar_id": calendar}).status_code == 204
    saved = client.post(f"/calendars/{calendar}/events/bulk", json={"events": [
        {"title": "Half day", "start_date": "2026-11-25", "end_date": "2026-11-25", "effect": "NOTE"},
    ]})
    assert saved.status_code in (200, 201), saved.text
    events = client.get(f"/calendars/{calendar}/events").json()
    assert events[0]["effect"] == "NOTE"


# --- Logging in to Anthropic ---------------------------------------------

FEDERATION_VARS = (
    "ANTHROPIC_API_KEY", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID",
    "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_IDENTITY_TOKEN_FILE",
)


@pytest.mark.parametrize("settings, expected", [
    ({}, False),
    ({"ANTHROPIC_API_KEY": "sk-ant-test"}, True),
    # OIDC: a rule, an organization, and a short-lived identity token (as a file or a value).
    ({"ANTHROPIC_FEDERATION_RULE_ID": "rule", "ANTHROPIC_ORGANIZATION_ID": "org",
      "ANTHROPIC_IDENTITY_TOKEN_FILE": "/var/run/token"}, True),
    ({"ANTHROPIC_FEDERATION_RULE_ID": "rule", "ANTHROPIC_ORGANIZATION_ID": "org",
      "ANTHROPIC_IDENTITY_TOKEN": "jwt"}, True),
    # Half set up is still off: without the token there's nothing to prove who we are.
    ({"ANTHROPIC_FEDERATION_RULE_ID": "rule", "ANTHROPIC_ORGANIZATION_ID": "org"}, False),
])
def test_reader_is_on_with_a_key_or_oidc(monkeypatch, settings, expected):
    for name in FEDERATION_VARS:
        monkeypatch.delenv(name, raising=False)
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    assert pdf_calendar.ai_available() is expected


def _refused(status: int):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, json={"type": "error", "error": {"message": "nope"}})
    cls = anthropic.AuthenticationError if status == 401 else anthropic.PermissionDeniedError
    return cls("refused", response=response, body=None)


@pytest.mark.parametrize("error", [_refused(401), _refused(403), anthropic.CredentialsError("token exchange failed")])
def test_a_refused_login_is_logged_clearly(monkeypatch, caplog, error):
    """An expired key must not look like a busy server: it's logged as an error that names the cause."""
    class FakeMessages:
        def parse(self, **_):
            raise error

    class FakeClient:
        def __init__(self, **_):
            self.messages = FakeMessages()

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    with pytest.raises(pdf_calendar.PdfError, match="switched off"):
        pdf_calendar.ask_claude(b"%PDF-1.4")
    assert any(r.levelname == "ERROR" and "login failed" in r.message for r in caplog.records)
