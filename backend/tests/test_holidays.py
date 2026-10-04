from datetime import date

from fastapi.testclient import TestClient

from vacation_optimizer.api import app
from vacation_optimizer.holidays import federal_calendar, federal_holidays


def observed_dates(year):
    calendar = federal_calendar(date(year, 1, 1), date(year, 12, 31))
    return [e.start for e in calendar.events]


def test_2026_observed_dates():
    assert observed_dates(2026) == [
        date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 5, 25),
        date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7), date(2026, 10, 12),
        date(2026, 11, 11), date(2026, 11, 26), date(2026, 12, 25),
    ]


def test_2027_includes_new_years_2028_observed_on_dec_31():
    assert observed_dates(2027) == [
        date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 5, 31),
        date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6), date(2027, 10, 11),
        date(2027, 11, 11), date(2027, 11, 25), date(2027, 12, 24), date(2027, 12, 31),
    ]


def test_generating_only_one_year_misses_dec_31():
    """The bug federal_calendar guards against by generating next year too."""
    only_2027 = [day for day, _ in federal_holidays(2027)]
    assert date(2027, 12, 31) not in only_2027


def test_holidays_endpoint():
    response = TestClient(app).get("/holidays/2026")
    assert response.status_code == 200
    assert response.json()[5] == {"date": "2026-07-03", "name": "Independence Day"}
