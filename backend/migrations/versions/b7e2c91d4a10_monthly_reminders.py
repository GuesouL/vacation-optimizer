"""monthly reminder email: opt-in flag and last-sent month on account

Revision ID: b7e2c91d4a10
Revises: cf1e8ce16769
Create Date: 2026-10-20 20:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e2c91d4a10'
down_revision: Union[str, Sequence[str], None] = 'cf1e8ce16769'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default so existing accounts become "off" instead of failing NOT NULL.
    op.add_column('account', sa.Column('reminders_on', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column('account', sa.Column('last_reminder', sa.String(length=7), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('account', 'last_reminder')
    op.drop_column('account', 'reminders_on')
