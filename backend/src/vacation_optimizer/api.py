"""FastAPI app. Phase 1 only exposes holidays; the optimizer endpoint comes next."""

from datetime import date

from fastapi import FastAPI
from pydantic import BaseModel

from .holidays import federal_calendar

app = FastAPI(title="Vacation Optimizer")


class Holiday(BaseModel):
    date: date
    name: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/holidays/{year}")
def holidays(year: int) -> list[Holiday]:
    """Observed federal holidays that fall in `year` (including next year's
    New Year's when it's observed on Dec 31)."""
    calendar = federal_calendar(date(year, 1, 1), date(year, 12, 31))
    return [Holiday(date=e.start, name=e.title) for e in calendar.events]
