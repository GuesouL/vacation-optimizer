"""POST /calendars/pdf-preview: a PDF school calendar in, suggested dates out.

Saves no schedule, exactly like /calendars/ics-preview: the screen shows the
suggestions and the ticked ones are saved through /events/bulk.

The order is cheapest first, and every step is there to keep the AI bill small:
1. Same file seen before (same SHA-256 fingerprint)? Answer from pdf_read. $0.
2. Text in the file that reads as a whole school year? Use it. $0.
3. Otherwise Claude Haiku reads it (~$0.001), if the limits allow:
   - PDF_AI_DAILY_PER_ACCOUNT (default 5): stops one account from burning the budget.
   - PDF_AI_MONTHLY_LIMIT (default 2000 reads, about $2-5): a ceiling for everyone,
     on top of the spending cap set in the Anthropic console.
   When a limit is hit, the text reading is returned with a note, never an error,
   so typing the dates in still works.
"""

import base64
import binascii
import hashlib
import os
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from . import orm
from .auth import CurrentAccount
from .db import DB
from .ics import Candidate
from .models import Effect
from .pdf_calendar import (
    PdfError,
    ai_available,
    ask_claude,
    from_ai,
    looks_complete,
    open_pdf,
    parse_text,
)
from .schemas import IcsEventOut, PdfIn, PdfPreviewOut

router = APIRouter()


def _limit(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def ai_blocked(session, account: orm.Account, kind: orm.CalendarKind) -> str | None:
    """Why the AI can't read this file right now, or None if it can."""
    if kind is not orm.CalendarKind.SCHOOL:
        return "Automatic reading is set up for school calendars only."
    if not ai_available():
        return "Automatic reading of scanned calendars isn't switched on yet."
    now = datetime.now(UTC)
    ai_reads = select(func.count()).select_from(orm.PdfRead).where(orm.PdfRead.method == "AI")
    today = session.scalar(ai_reads.where(
        orm.PdfRead.account_id == account.id, orm.PdfRead.created_at > now - timedelta(days=1)
    ))
    if today >= _limit("PDF_AI_DAILY_PER_ACCOUNT", 5):
        return "You've reached today's limit for reading calendars automatically. Try again tomorrow."
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if session.scalar(ai_reads.where(orm.PdfRead.created_at >= month_start)) >= _limit("PDF_AI_MONTHLY_LIMIT", 2000):
        return "Automatic reading is paused for the rest of the month."
    return None


def _store(session, digest: str, account: orm.Account, method: str, events: list[Candidate]) -> None:
    session.add(orm.PdfRead(
        sha256=digest, account_id=account.id, method=method,
        events=[
            {"title": c.title, "start": c.start.isoformat(), "end": c.end.isoformat(),
             "effect": c.effect.value, "selected": c.selected}
            for c in events
        ],
    ))
    try:
        session.commit()
    except IntegrityError:  # two uploads of the same file at once: the first one's row wins
        session.rollback()


def _from_store(row: orm.PdfRead) -> list[Candidate]:
    return [
        Candidate(e["title"], date.fromisoformat(e["start"]), date.fromisoformat(e["end"]),
                  Effect(e["effect"]), e["selected"], False)
        for e in row.events
    ]


def _out(events: list[Candidate], method: str, note: str | None = None) -> PdfPreviewOut:
    return PdfPreviewOut(
        events=[
            IcsEventOut(title=c.title, start_date=c.start, end_date=c.end,
                        effect=c.effect, selected=c.selected, timed=c.timed)
            for c in events
        ],
        skipped_recurring=0, skipped_too_long=0, skipped_invalid=0, truncated=False,
        method=method, note=note,
    )


@router.post("/calendars/pdf-preview")
def pdf_preview(body: PdfIn, account: CurrentAccount, session: DB) -> PdfPreviewOut:
    """Read a PDF calendar and suggest events. Saves no schedule: see the module docstring."""
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "That file didn't arrive in one piece. Try again.") from None
    try:
        _, text = open_pdf(data)
    except PdfError as error:
        raise HTTPException(422, str(error)) from None

    digest = hashlib.sha256(data).hexdigest()
    cached = session.scalar(select(orm.PdfRead).where(orm.PdfRead.sha256 == digest))
    if cached is not None:
        return _out(_from_store(cached), "CACHE")

    from_text = parse_text(text, body.kind)
    if looks_complete(from_text):
        _store(session, digest, account, "TEXT", from_text)
        return _out(from_text, "TEXT")

    blocked = ai_blocked(session, account, body.kind)
    if blocked:
        # Not stored: once the AI is available, the same file should get a proper reading.
        note = blocked + (" Here's what we could read from the text." if from_text else " You can type the dates in instead.")
        return _out(from_text, "TEXT" if from_text else "NONE", note)

    try:
        events = from_ai(ask_claude(data), body.kind)
    except PdfError as error:
        return _out(from_text, "TEXT" if from_text else "NONE", str(error))
    _store(session, digest, account, "AI", events)
    return _out(events, "AI")
