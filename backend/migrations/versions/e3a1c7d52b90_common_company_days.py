"""common company days: a second computed calendar (day after Thanksgiving,
Christmas Eve, New Year's Eve) people can switch on next to the federal one

Like the federal calendar it has no event rows: holidays.company_days computes
the dates, so it never needs a yearly update.

Revision ID: e3a1c7d52b90
Revises: b7e2c91d4a10
Create Date: 2026-10-23 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e3a1c7d52b90'
down_revision: Union[str, Sequence[str], None] = 'b7e2c91d4a10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres won't use a new enum value inside the transaction that added it,
    # so the value gets its own committed step first.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE calendar_kind ADD VALUE IF NOT EXISTS 'COMPANY'")
    # owner_account_id stays NULL: shared, and read-only like the federal calendar.
    op.execute("INSERT INTO calendar (name, kind) VALUES ('Common company days', 'COMPANY')")


def downgrade() -> None:
    """Downgrade schema."""
    # Deleting the calendar removes everyone's link to it (ON DELETE CASCADE).
    op.execute("DELETE FROM calendar WHERE kind = 'COMPANY'")
    # Postgres can't drop one enum value, so rebuild the type without it.
    op.execute("ALTER TYPE calendar_kind RENAME TO calendar_kind_old")
    op.execute("CREATE TYPE calendar_kind AS ENUM ('FEDERAL', 'WORK', 'SCHOOL', 'LEAGUE', 'CUSTOM')")
    op.execute("ALTER TABLE calendar ALTER COLUMN kind TYPE calendar_kind USING kind::text::calendar_kind")
    op.execute("DROP TYPE calendar_kind_old")
