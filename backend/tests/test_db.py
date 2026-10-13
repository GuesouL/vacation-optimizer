"""Database URLs as hosting sites hand them out."""

import pytest

from vacation_optimizer.db import normalize_database_url


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql://u:p@host/db?sslmode=require", "postgresql+psycopg://u:p@host/db?sslmode=require"),
        # Already names its driver, so it is left alone (this is what local dev and CI use).
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
    ],
)
def test_hosted_urls_name_the_installed_driver(given, expected):
    assert normalize_database_url(given) == expected
