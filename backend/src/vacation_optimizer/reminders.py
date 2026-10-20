"""The monthly reminder: "you have N PTO days left, and here are next month's
best breaks." Kept apart from how it's delivered (email, push or an in-app
card), so the content is built and tested once whichever way it's sent."""

import calendar
from datetime import date, timedelta

from fastapi import APIRouter
from pydantic import BaseModel

from . import orm
from .access import can_see_group, manages, not_found
from .auth import CurrentAccount
from .db import DB
from .loader import pto_left
from .schemas import WindowOut
from .search import SearchParams, load_group, search_group
from .trips import Today

router = APIRouter()

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


def digest_text(digest: DigestOut, plan_name: str) -> tuple[str, str]:
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
    lines += ["", f"Open {plan_name} to save one."]
    return subject, "\n".join(lines).strip()


@router.get("/groups/{group_id}/digest")
def get_digest(group_id: int, account: CurrentAccount, session: DB, today: Today) -> DigestOut:
    """Next month's reminder for this plan, as you'd receive it."""
    group = load_group(session, group_id)
    if group is None or not can_see_group(account, group):
        raise not_found(orm.Group, group_id)
    return build_digest(session, group, account, today)
