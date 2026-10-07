import os
from datetime import UTC, date, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from vacation_optimizer.api import app
from vacation_optimizer.auth import ALGORITHM, AUDIENCE
from vacation_optimizer.db import get_session
from vacation_optimizer.holidays import federal_calendar
from vacation_optimizer.models import Person

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://vacation:vacation@localhost:5432/vacation_test"
)
TEST_SECRET = "test-secret-not-for-production-at-least-32-bytes"

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


def token(email="parent@example.com", secret=TEST_SECRET, expires_in=timedelta(minutes=15), **claims):
    """The same kind of token the Next.js app mints after sign-in."""
    payload = {"email": email, "aud": AUDIENCE, "exp": datetime.now(UTC) + expires_in, **claims}
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def sign_in(client, email):
    client.headers["Authorization"] = f"Bearer {token(email)}"


@pytest.fixture(scope="session")
def db_engine():
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def client(db_engine, monkeypatch):
    """A signed-in API client. Each test runs in a transaction that's rolled back
    afterward, so tests can't leak data into each other."""
    monkeypatch.setenv("API_TOKEN_SECRET", TEST_SECRET)
    with db_engine.connect() as connection:
        transaction = connection.begin()
        # Every commit() inside the app becomes a savepoint inside our transaction.
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        app.dependency_overrides[get_session] = lambda: session
        test_client = TestClient(app)
        sign_in(test_client, "parent@example.com")
        yield test_client
        app.dependency_overrides.clear()
        session.close()
        transaction.rollback()
