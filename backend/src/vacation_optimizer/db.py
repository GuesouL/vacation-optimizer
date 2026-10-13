"""Database connection. One engine per process; one session per request."""

import os
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def normalize_database_url(url: str) -> str:
    """Hosting sites hand out `postgres://...` or `postgresql://...`. SQLAlchemy reads
    both as "use some default driver", and `postgres://` isn't understood at all, so
    name the driver we actually install (psycopg 3) and leave everything else alone."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


# Read from the environment so dev, test and production each point at their own database.
DATABASE_URL = normalize_database_url(
    os.environ.get("DATABASE_URL", "postgresql+psycopg://vacation:vacation@localhost:5432/vacation")
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: opens a session for one request and always closes it."""
    with SessionLocal() as session:
        yield session


DB = Annotated[Session, Depends(get_session)]
