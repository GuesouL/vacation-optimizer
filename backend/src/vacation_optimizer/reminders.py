"""The monthly reminder: "you have N PTO days left, and here are next month's
best breaks." Kept apart from how it's delivered (email, push or an in-app
card), so the content is built and tested once whichever way it's sent."""

import calendar
import hmac
import logging
import os
from datetime import date, timedelta
from typing import Annotated, Callable

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from . import mailer, orm
from .access import can_see_group, manages, my_groups, not_found
from .auth import CurrentAccount
from .db import DB
from .loader import pto_left
from .schemas import WindowOut
from .search import SearchParams, load_group, search_group
from .trips import Today

router = APIRouter()
log = logging.getLogger(__name__)

PICKS = 3  # breaks per reminder: enough to choose from, short enough to read


class PersonPTO(BaseModel):
    name: str
    pto_left: int


class DigestOut(BaseModel):
    month: str  # "November 2026"
    people: list[PersonPTO]  # the adults you manage in this group
    breaks: list[WindowOut]  # best value, starting next month
    free_weekends: list[WindowOut]  # no PTO needed, starting next month


def next_month(today: date) -> tuple[date, date]:
    """First and last day of the month after `today`."""
    first = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    return first, first.replace(day=calendar.monthrange(first.year, first.month)[1])


def build_digest(session, group: orm.Group, account: orm.Account, today: date) -> DigestOut:
    first, last = next_month(today)
    # Search a little past the month so a break that starts on the 30th still fits.
    result = search_group(session, group, SearchParams(start=first, end=last + timedelta(days=16), limit=50))

    def starting_next_month(windows: list[WindowOut]) -> list[WindowOut]:
        return [w for w in windows if first <= w.start <= last][:PICKS]

    people = []
    for member in group.members:
        person = member.person
        if person.kind is orm.PersonKind.ADULT and manages(account, person):
            left, _ = pto_left(session, person, today)
            if left is not None:
                people.append(PersonPTO(name=person.name, pto_left=left))
    return DigestOut(
        month=first.strftime("%B %Y"),
        people=people,
        breaks=starting_next_month(result.windows),
        free_weekends=starting_next_month(result.free_long_weekends),
    )


def short_range(w: WindowOut) -> str:
    """"Nov 26 – Nov 29", like the app's cards."""
    return f"{w.start:%b} {w.start.day} – {w.end:%b} {w.end.day}"


def digest_text(digest: DigestOut, plan_name: str, link: str = "") -> tuple[str, str]:
    """Subject and plain-text body, for email or a push notification."""
    left = ", ".join(f"{p.name} {p.pto_left}" for p in digest.people)
    subject = f"{digest.month}: your best days off"
    lines = [f"PTO days left: {left}." if left else "", ""]
    if digest.breaks:
        lines.append(f"Best breaks starting in {digest.month}:")
        for w in digest.breaks:
            cost = max(w.pto_cost.values(), default=0)
            lines.append(f"• {short_range(w)}: {w.days} days off for {cost} PTO day{'s' if cost != 1 else ''}")
    if digest.free_weekends:
        lines.append("Long weekends with no PTO needed:")
        lines += [f"• {short_range(w)}" for w in digest.free_weekends]
    if not digest.breaks and not digest.free_weekends:
        lines.append(f"No good breaks start in {digest.month}. We'll check again next month.")
    lines += ["", f"Open {plan_name} to save one." + (f" {link}" if link else "")]
    lines += ["", "You get this because you turned on monthly reminders in Settings. Turn them off there any time."]
    return subject, "\n".join(lines).strip()


@router.get("/groups/{group_id}/digest")
def get_digest(group_id: int, account: CurrentAccount, session: DB, today: Today) -> DigestOut:
    """Next month's reminder for this plan, as you'd receive it."""
    group = load_group(session, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    return build_digest(session, group, account, today)


class ReminderSwitch(BaseModel):
    enabled: bool


@router.put("/me/reminders")
def set_reminders(body: ReminderSwitch, account: CurrentAccount, session: DB) -> ReminderSwitch:
    """Turn the monthly email on or off for yourself."""
    account.reminders_on = body.enabled
    session.commit()
    return body


class SendResult(BaseModel):
    sent: int
    failed: int
    errors: list[str] = []  # why each failure happened; no addresses, so safe to show in a job log


def send_due(session, today: date, send: Callable[[str, str, str], None]) -> SendResult:
    """Email every opted-in account that hasn't had this month's reminder yet.
    One broken address must not stop everyone else, so each send is its own attempt."""
    month = f"{today:%Y-%m}"
    link = os.environ.get("APP_URL", "")
    accounts = session.scalars(
        select(orm.Account).where(
            orm.Account.reminders_on,
            (orm.Account.last_reminder.is_(None)) | (orm.Account.last_reminder != month),
        )
    ).all()
    sent = failed = 0
    errors: list[str] = []
    for account in accounts:
        groups = my_groups(session, account)
        if not groups:
            continue
        group = groups[0]  # one email per person, about their first plan
        try:
            subject, body = digest_text(build_digest(session, group, account, today), group.name, link)
            send(account.email, subject, body)
        except Exception as exc:
            log.exception("reminder failed for account %s", account.id)
            errors.append(f"account {account.id}: {exc}"[:400])
            failed += 1
            continue
        account.last_reminder = month  # recorded only after the send worked, so a retry covers failures
        session.commit()
        sent += 1
    return SendResult(sent=sent, failed=failed, errors=errors)


@router.post("/internal/send-reminders")
def send_reminders(
    session: DB, today: Today, response: Response, authorization: Annotated[str | None, Header()] = None
) -> SendResult:
    """Called once a month by a scheduler (see .github/workflows/reminders.yml).
    Guarded by a shared secret, not a user login: no person is behind this call."""
    secret = os.environ.get("CRON_SECRET")
    if not secret:
        raise HTTPException(500, "CRON_SECRET is not set on the server")  # fail closed
    # compare_digest takes the same time however many characters match, so the
    # secret can't be guessed one character at a time by timing responses.
    if not hmac.compare_digest(authorization or "", f"Bearer {secret}"):
        raise HTTPException(401, "Not allowed")
    result = send_due(session, today, mailer.send_email)
    if result.failed:
        # Answer 502 so the scheduled job turns red. A green run that quietly sent nothing
        # is the worst way for this to fail: nobody would know to look.
        response.status_code = 502
    return result
