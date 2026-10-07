"""Database connection. One engine per process; one session per request."""

import os
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Read from the environment so dev, test and production each point at their own database.
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://vacation:vacation@localhost:5432/vacation"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: opens a session for one request and always closes it."""
    with SessionLocal() as session:
        yield session


DB = Annotated[Session, Depends(get_session)]
