"""date range index on calendar events

Revision ID: 56193c3d6d1e
Revises: 179299e3f605
Create Date: 2026-10-04 21:08:07.207456

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '56193c3d6d1e'
down_revision: Union[str, Sequence[str], None] = '179299e3f605'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # btree_gist teaches GiST indexes to hold plain values like calendar_id,
    # so one index covers "this calendar AND these dates".
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.create_index(
        "ix_calendar_event_calendar_dates",
        "calendar_event",
        ["calendar_id", sa.text("daterange(start_date, end_date, '[]')")],
        postgresql_using="gist",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_calendar_event_calendar_dates", table_name="calendar_event")
    # The extension stays: dropping it could break other objects that use it.
