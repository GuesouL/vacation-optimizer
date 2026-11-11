"""school districts: a searchable list of US districts, and calendars tied to them

The table starts with one row, New York City, so the NYC calendar seeded earlier
hangs off a real district. The other ~13,000 come from the federal list through
scripts/import_districts.py: that data changes every year, so it's loaded by a
script you can re-run, not frozen into a migration.

Revision ID: f4b8d2a61c37
Revises: e3a1c7d52b90
Create Date: 2026-11-11 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4b8d2a61c37'
down_revision: Union[str, Sequence[str], None] = 'e3a1c7d52b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # pg_trgm adds "trigram" matching: fast "contains" searches and typo-tolerant
    # "looks like" scores. It ships with Postgres (Neon included).
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        "district",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nces_id", sa.String(length=7), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("state", sa.String(length=2), nullable=False),
        sa.Column("zip", sa.String(length=5), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nces_id"),
    )
    op.create_index("ix_district_state", "district", ["state"])
    op.create_index("ix_district_zip", "district", ["zip"])
    op.create_index(
        "ix_district_name_trgm", "district", ["name"],
        postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_district_city_trgm", "district", ["city"],
        postgresql_using="gin", postgresql_ops={"city": "gin_trgm_ops"},
    )

    op.add_column("calendar", sa.Column("district_id", sa.Integer(), nullable=True))
    op.add_column("calendar", sa.Column("school_year", sa.String(length=7), nullable=True))
    op.create_foreign_key(
        "calendar_district_id_fkey", "calendar", "district", ["district_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_calendar_district_id", "calendar", ["district_id"])

    # NYC's federal id is 3620580. The import script updates this row in place.
    op.execute(
        "INSERT INTO district (nces_id, name, city, state, zip) "
        "VALUES ('3620580', 'New York City Department of Education', 'New York', 'NY', '10007')"
    )
    op.execute(
        "UPDATE calendar SET district_id = (SELECT id FROM district WHERE nces_id = '3620580'), "
        "school_year = '2026-27' WHERE name = 'NYC Public Schools 2026-27' AND owner_account_id IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_calendar_district_id", table_name="calendar")
    op.drop_constraint("calendar_district_id_fkey", "calendar", type_="foreignkey")
    op.drop_column("calendar", "school_year")
    op.drop_column("calendar", "district_id")
    op.drop_index("ix_district_city_trgm", table_name="district")
    op.drop_index("ix_district_name_trgm", table_name="district")
    op.drop_index("ix_district_zip", table_name="district")
    op.drop_index("ix_district_state", table_name="district")
    op.drop_table("district")
    # pg_trgm stays installed: dropping an extension other things may use is not this migration's call.
