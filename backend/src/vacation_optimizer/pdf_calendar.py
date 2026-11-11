"""Read a PDF school calendar into candidate dates for the user to review.

Like ics.py, nothing here is saved as a schedule: it produces suggestions, the
user ticks what counts, and the ticked rows go through /events/bulk.

Two readers, cheapest first:
1. Text. Many PDFs exported from Word or Excel carry real text, and lines like
   "Winter Recess: December 24, 2026 - January 1, 2027" can be read for free.
   The result is trusted only if it looks like a whole school year (see
   `looks_complete`); a calendar where only footnotes have full dates would
   otherwise give a half list that looks finished.
2. Claude Haiku. It sees each page as text and as an image, so it can read
   scanned pages and month grids where the days off are only shaded in color.
   Costs about a tenth of a cent per calendar; limits live in pdf_preview.py.
"""

import base64
import io
import logging
import os
import re
from datetime import date, timedelta

from pydantic import BaseModel, Field
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .ics import MAX_SPAN_DAYS, Candidate, suggest
from .models import Effect
from .orm import CalendarKind

log = logging.getLogger(__name__)

MAX_BYTES = 5_000_000
MAX_PAGES = 10
AI_MODEL = "claude-haiku-5-5"  # the cheapest current model; the review step catches its mistakes

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_DAY = r"(\d{1,2})(?:st|nd|rd|th)?(?!\d)"
_YEAR = r"(?:,?\s*(20\d\d))?"
# "December 24, 2026 - January 1, 2027", "Nov 26-27", "November 3rd", "Feb 15 through 19"
DATE_RANGE = re.compile(
    rf"\b{_MONTH}\s+{_DAY}{_YEAR}"
    rf"(?:\s*(?:-|–|—|to|through|thru)\s*(?:{_MONTH}\s+)?{_DAY}{_YEAR})?",
    re.IGNORECASE,
)
SCHOOL_YEAR = re.compile(r"\b(20\d\d)\s*[-–/]\s*(?:20)?(\d\d)\b")


class PdfError(ValueError):
    """The file can't be read as a calendar; the message is shown to the user."""


def open_pdf(data: bytes) -> tuple[int, str]:
    """(page count, all text). Raises PdfError for files we won't read."""
    if len(data) > MAX_BYTES:
        raise PdfError("That PDF is too big (the limit is 5 MB)")
    if not data.startswith(b"%PDF"):
        raise PdfError("That doesn't look like a PDF file")
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = len(reader.pages)
        if pages > MAX_PAGES:
            raise PdfError(f"That PDF has {pages} pages; a school calendar should fit in {MAX_PAGES}")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except PdfError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError) as error:
        raise PdfError("That PDF couldn't be opened. Is it password-protected or damaged?") from error
    return pages, text


def school_year_start(text: str) -> int | None:
    """The fall year of the school year the calendar is for: '2026-2027' or '2026-27' -> 2026."""
    for match in SCHOOL_YEAR.finditer(text):
        first, second = int(match.group(1)), int(match.group(2))
        if second == (first + 1) % 100:
            return first
    return None


def _date(fall_year: int, month: int, day: int, year: int | None) -> date:
    # A school year runs Aug-Jun: fall months take the first year, spring months the next.
    return date(year or (fall_year if month >= 7 else fall_year + 1), month, day)


def parse_text(text: str, kind: CalendarKind = CalendarKind.SCHOOL) -> list[Candidate]:
    """Every line with a written-out month and day, as a suggestion. Free, and fast."""
    fall_year = school_year_start(text)
    if fall_year is None:
        return []  # without the year, "Nov 26" could be any November
    found: dict[tuple[str, date, date], Candidate] = {}
    for line in text.splitlines():
        for match in DATE_RANGE.finditer(line):
            m1, d1, y1, m2, d2, y2 = match.groups()
            try:
                start_month = MONTHS[m1.lower()[:3]]
                end_month = MONTHS[m2.lower()[:3]] if m2 else start_month
                start = _date(fall_year, start_month, int(d1), int(y1) if y1 else None)
                end = _date(fall_year, end_month, int(d2), int(y2) if y2 else None) if d2 else start
            except ValueError:  # "February 30"
                continue
            if not (timedelta(0) <= end - start < timedelta(days=MAX_SPAN_DAYS)):
                continue
            title = _title(line, match)
            effect, selected = suggest(title, kind, timed=False)
            found.setdefault((title, start, end), Candidate(title, start, end, effect, selected, False))
    return sorted(found.values(), key=lambda c: (c.start, c.end, c.title))


def _title(line: str, match: re.Match) -> str:
    """The words around the date, without the date and the dashes that joined them."""
    rest = (line[: match.start()] + " " + line[match.end():]).strip(" -–—:,.*")
    rest = re.sub(r"\s+", " ", rest)
    return rest[:200] or "School calendar date"


def looks_complete(candidates: list[Candidate]) -> bool:
    """Does the text reading look like a whole school year? A real calendar has a winter
    break and a spring break, plus a handful of other days off. Anything less means the
    breaks were in a grid or a picture we couldn't read, so the AI should read it."""
    days_off = [c for c in candidates if c.effect is Effect.DAY_OFF]
    winter = any(c.start.month in (12, 1) and (c.end - c.start).days >= 2 for c in days_off)
    spring = any(c.start.month in (3, 4) and (c.end - c.start).days >= 2 for c in days_off)
    return winter and spring and len(days_off) >= 6


# --- Claude ---------------------------------------------------------------


class AiEvent(BaseModel):
    title: str = Field(description="Short name as printed, e.g. 'Winter Recess'. Add '(elementary only)' etc. if it applies to some grades only.")
    start: str = Field(description="First day, YYYY-MM-DD")
    end: str = Field(description="Last day, inclusive, YYYY-MM-DD. Same as start for a single day.")
    no_school: bool = Field(description="True if students have no school that day (holiday, recess, conference or staff day closed to students).")


class AiCalendar(BaseModel):
    events: list[AiEvent]


PROMPT = """This PDF is a US school's academic calendar. List the dates a parent planning a family trip needs.

Include every day or range when students have NO school: holidays, recesses and breaks, \
superintendent's or staff development days, conference days closed to students, and days the \
legend marks as "schools closed" (often shown only as a color or symbol in the month grid: use the legend). \
Set no_school=true for these.

Also include half days, the first and last day of school, and pending or makeup days, with no_school=false.

Rules:
- Read every page. Later pages (notes, signed agreements) can add or change days.
- Merge consecutive days off into one range (Dec 24 to Dec 31 is one event).
- Use the calendar's own school year to pick the year of each date.
- If a closure applies to some grades or buildings only, still include it and say who in the title.
- Do not invent dates. If nothing in the file is a school calendar, return no events."""


def ai_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def ask_claude(data: bytes) -> AiCalendar:
    """One request to Claude with the PDF attached. Raises PdfError if it can't help."""
    import anthropic  # imported here so the API starts fine without the package configured

    client = anthropic.Anthropic(timeout=90.0, max_retries=1)
    try:
        response = client.messages.parse(
            model=AI_MODEL,
            max_tokens=8000,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "document", "source": {
                        "type": "base64", "media_type": "application/pdf",
                        "data": base64.standard_b64encode(data).decode(),
                    }},
                    {"type": "text", "text": PROMPT},
                ],
            }],
            output_format=AiCalendar,
        )
    except anthropic.APIError as error:
        log.warning("Claude couldn't read a PDF calendar: %s", error)
        raise PdfError("The calendar reader is busy right now. Try again in a minute, or type the dates in.") from error
    log.info("PDF calendar read: %s input / %s output tokens", response.usage.input_tokens, response.usage.output_tokens)
    if response.stop_reason != "end_turn" or response.parsed_output is None:
        raise PdfError("We couldn't read dates from that PDF. Try typing them in instead.")
    return response.parsed_output


def from_ai(calendar: AiCalendar, kind: CalendarKind = CalendarKind.SCHOOL) -> list[Candidate]:
    """Turn Claude's answer into the same suggestions the .ics reader makes. Bad dates are dropped."""
    found: dict[tuple[str, date, date], Candidate] = {}
    for event in calendar.events:
        try:
            start, end = date.fromisoformat(event.start), date.fromisoformat(event.end)
        except ValueError:
            continue
        if end < start or (end - start).days >= MAX_SPAN_DAYS:
            continue
        title = " ".join(event.title.split())[:200] or "School calendar date"
        # Half days and first/last days are school days: shown as notes, never freeing the day.
        effect = Effect.DAY_OFF if event.no_school else Effect.NOTE
        selected = True
        found.setdefault((title, start, end), Candidate(title, start, end, effect, selected, False))
    return sorted(found.values(), key=lambda c: (c.start, c.end, c.title))
