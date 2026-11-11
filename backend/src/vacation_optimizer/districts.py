"""Find a school district by typing, instead of scrolling a list of 13,000.

How the search works, in order:
- Five digits are a ZIP code: districts whose office is in that ZIP.
- Anything else matches the district's name or city, anywhere in the text
  ("wood" finds Brentwood), plus close spellings ("brentwod") through pg_trgm's
  word_similarity score.
- Names that START with what you typed come first, then the closest spellings.

Each result says whether the district already has a shared calendar, so the
screen can offer "ready, just pick it" or "be the first to add it".
"""

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import case, func, or_, select

from . import orm
from .auth import CurrentAccount
from .db import DB
from .schemas import DistrictCalendarOut, DistrictOut

router = APIRouter()

MAX_RESULTS = 8  # enough to spot yours, few enough to fit a phone screen without scrolling
SIMILAR_ENOUGH = 0.5  # word_similarity runs 0-1; 0.5 still catches one wrong letter in a short word


def _like_pattern(text: str) -> str:
    """Escape the two ILIKE wildcards, so typing "%" searches for a percent sign."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("/districts")
def search_districts(
    account: CurrentAccount,
    session: DB,
    q: Annotated[str, Query(min_length=2, max_length=100)],
    state: Annotated[str | None, Query(pattern="^[A-Za-z]{2}$")] = None,
) -> list[DistrictOut]:
    """Up to 8 districts matching a name, city or ZIP. `state=TX` narrows it."""
    q = " ".join(q.split())
    District = orm.District
    query = select(District)
    if q.isdigit() and len(q) == 5:
        query = query.where(District.zip == q).order_by(District.name)
    else:
        pattern = _like_pattern(q)
        score = func.word_similarity(q, District.name)
        query = query.where(
            or_(District.name.ilike(pattern), District.city.ilike(pattern), score >= SIMILAR_ENOUGH)
        ).order_by(
            case((District.name.ilike(pattern.removeprefix("%")), 0), else_=1),
            score.desc(),
            District.name,
        )
    if state:
        query = query.where(District.state == state.upper())
    districts = session.scalars(query.limit(MAX_RESULTS)).all()

    calendars = _newest_calendars(session, [d.id for d in districts])
    return [
        DistrictOut(
            id=d.id, name=d.name, city=d.city, state=d.state,
            calendar=DistrictCalendarOut.model_validate(calendars[d.id]) if d.id in calendars else None,
        )
        for d in districts
    ]


def _newest_calendars(session, district_ids: list[int]) -> dict[int, orm.Calendar]:
    """Each district's newest shared school calendar, in one query instead of one per row."""
    if not district_ids:
        return {}
    rows = session.scalars(
        select(orm.Calendar)
        .where(
            orm.Calendar.district_id.in_(district_ids),
            orm.Calendar.owner_account_id.is_(None),
            orm.Calendar.kind == orm.CalendarKind.SCHOOL,
        )
        .order_by(orm.Calendar.school_year.desc().nulls_last(), orm.Calendar.id.desc())
    ).all()
    newest: dict[int, orm.Calendar] = {}
    for calendar in rows:
        newest.setdefault(calendar.district_id, calendar)
    return newest
