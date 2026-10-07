"""seed NYC school calendar: a shared calendar parents can pick for a kid

Days students are off, from the official 2026-27 calendar:
https://www.schools.nyc.gov/docs/default-source/sections/calendar/2026-27-school-year-calendar.pdf
Remote days (Nov 3) and half days count as school days. Feb 1 is off for high
school only; grade bands aren't modeled yet, so it's left out (the safe choice:
we never promise a day off that some kids don't get).

Revision ID: 54c7def84071
Revises: 4d934a61de77
Create Date: 2026-10-07 00:28:31.256836

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '54c7def84071'
down_revision: Union[str, Sequence[str], None] = '4d934a61de77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NAME = "NYC Public Schools 2026-27"

DAYS_OFF = [
    # (title, first day, last day) - inclusive
    ("Summer break", "2026-06-29", "2026-09-09"),  # before the first day, Thu Sep 10
    ("Yom Kippur", "2026-09-21", "2026-09-21"),
    ("Italian Heritage/Indigenous Peoples' Day", "2026-10-12", "2026-10-12"),
    ("Veterans Day", "2026-11-11", "2026-11-11"),
    ("Thanksgiving Recess", "2026-11-26", "2026-11-27"),
    ("Winter Recess", "2026-12-24", "2027-01-01"),
    ("Martin Luther King Jr. Day", "2027-01-18", "2027-01-18"),
    ("Midwinter Recess", "2027-02-15", "2027-02-19"),
    ("Lunar New Year", "2027-03-09", "2027-03-09"),
    ("Eid al-Fitr", "2027-03-26", "2027-03-26"),
    ("Spring Recess", "2027-04-22", "2027-04-30"),
    ("Chancellor's Conference Day", "2027-05-17", "2027-05-17"),
    ("Memorial Day", "2027-05-31", "2027-05-31"),
    # The 2027-28 start date isn't published yet. Ending summer on Aug 31 is
    # conservative: NYC has started after Labor Day, so we may under-promise
    # a few days, but never over-promise.
    ("Summer break", "2027-06-29", "2027-08-31"),
]


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    # owner_account_id stays NULL: a shared calendar anyone can subscribe to, nobody can edit.
    calendar_id = bind.execute(
        sa.text("INSERT INTO calendar (name, kind) VALUES (:name, 'SCHOOL') RETURNING id"),
        {"name": NAME},
    ).scalar_one()
    for title, start, end in DAYS_OFF:
        bind.execute(
            sa.text(
                "INSERT INTO calendar_event (calendar_id, title, start_date, end_date, effect) "
                "VALUES (:calendar_id, :title, :start, :end, 'DAY_OFF')"
            ),
            {"calendar_id": calendar_id, "title": title, "start": start, "end": end},
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Events go with it (ON DELETE CASCADE). Kids subscribed to it lose the link too.
    op.execute(sa.text("DELETE FROM calendar WHERE name = :name AND owner_account_id IS NULL").bindparams(name=NAME))
