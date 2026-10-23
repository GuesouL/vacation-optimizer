from datetime import date

from fastapi.testclient import TestClient

from vacation_optimizer.api import app
from vacation_optimizer.holidays import company_days, federal_calendar, federal_holidays


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


def test_company_days_move_off_weekends_and_off_the_holiday_itself():
    # 2027: Christmas (Sat) is observed Fri Dec 24, and New Year's 2028 (Sat) on
    # Fri Dec 31, so both eves step back to Thursday.
    assert company_days(2027) == [
        (date(2027, 11, 26), "Day after Thanksgiving"),
        (date(2027, 12, 23), "Christmas Eve"),
        (date(2027, 12, 30), "New Year's Eve"),
    ]
    # 2028: Dec 24 and Dec 31 are Sundays, so the eves are the Fridays before.
    assert [d for d, _ in company_days(2028)] == [date(2028, 11, 24), date(2028, 12, 22), date(2028, 12, 29)]
    # 2026: plain weekdays stay put.
    assert [d for d, _ in company_days(2026)] == [date(2026, 11, 27), date(2026, 12, 24), date(2026, 12, 31)]


def test_company_days_endpoint():
    response = TestClient(app).get("/company-days/2026")
    assert response.status_code == 200
    assert response.json()[0] == {"date": "2026-11-27", "name": "Day after Thanksgiving"}
