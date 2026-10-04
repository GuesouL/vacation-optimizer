from datetime import date

import pytest

from vacation_optimizer.holidays import federal_calendar
from vacation_optimizer.models import Person

# The planning year used by the test cases: the 2026-27 school year.
YEAR_START = date(2026, 9, 10)
YEAR_END = date(2027, 6, 28)


@pytest.fixture
def federal():
    return federal_calendar(date(2026, 1, 1), date(2028, 12, 31))


@pytest.fixture
def make_adult(federal):
    def make(name, pto, **kwargs):
        return Person(name, pto, calendars=[federal, *kwargs.pop("calendars", [])], **kwargs)

    return make
