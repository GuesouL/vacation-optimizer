"""Load the federal list of US school districts into the `district` table.

Where the file comes from: the National Center for Education Statistics (NCES)
Common Core of Data, "LEA Directory" for the newest school year. Download the CSV
(it's free and public) from https://nces.ed.gov/ccd/files.asp , unzip it, then:

    cd backend
    DATABASE_URL=... uv run python scripts/import_districts.py path/to/ccd_lea_029_....csv

Safe to run again every year: rows are matched on the federal district id
(LEAID), so a renamed district is updated, never duplicated, and calendars
already tied to it stay tied.

It also reads the Urban Institute Education Data export of the same list
(lowercase column names), so either download works.
"""

import csv
import string
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import insert

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from vacation_optimizer.db import DATABASE_URL  # noqa: E402
from vacation_optimizer.orm import District  # noqa: E402

# Each field we need, and the column names it goes by in the files we accept.
COLUMNS = {
    "nces_id": ("LEAID", "leaid"),
    "name": ("LEA_NAME", "lea_name"),
    "city": ("LCITY", "city_location"),
    "state": ("LSTATE", "ST", "state_location"),
    "zip": ("LZIP", "zip_location"),
    "type": ("LEA_TYPE", "agency_type"),
    "status": ("SY_STATUS", "agency_status"),
}

# NCES district types that families actually enroll kids in: 1 regular district,
# 2 part of a supervisory union, 7 charter district. Left out: service agencies,
# state and federal agencies, and other administrative bodies.
SCHOOL_TYPES = {"1", "2", "7"}
CLOSED = {"2"}  # status 2 = closed this year

# Short forms that should stay in capitals when an ALL-CAPS name is tidied up.
ACRONYMS = {"ISD", "CISD", "USD", "UFSD", "CSD", "SD", "ESD", "UHSD", "RSU", "SAU", "MSAD", "CUSD", "II", "III", "IV"}

BATCH = 1000


def pick(row: dict, field: str) -> str | None:
    for column in COLUMNS[field]:
        if column in row and row[column] is not None:
            return row[column].strip()
    return None


def tidy(name: str) -> str:
    """'BRENTWOOD UFSD' -> 'Brentwood UFSD'. Mixed-case names are left as they are."""
    if not name.isupper():
        return name
    return " ".join(word if word in ACRONYMS else string.capwords(word, "-") for word in name.split())


def read_districts(path: Path) -> list[dict]:
    """Rows ready for the table. Closed districts and non-school agencies are skipped."""
    with path.open(newline="", encoding="utf-8-sig") as file:  # -sig: Excel adds a BOM
        reader = csv.DictReader(file)
        missing = [field for field in ("nces_id", "name", "city", "state", "zip")
                   if not set(COLUMNS[field]) & set(reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"{path.name} has no column for: {', '.join(missing)}. Is it the LEA directory file?")
        districts = {}
        for row in reader:
            kind, status = pick(row, "type"), pick(row, "status")
            if kind is not None and kind not in SCHOOL_TYPES:
                continue
            if status is not None and status in CLOSED:
                continue
            nces_id = (pick(row, "nces_id") or "").zfill(7)  # spreadsheets drop leading zeros
            zip_code = (pick(row, "zip") or "")[:5].zfill(5)
            if len(nces_id) != 7 or not nces_id.isdigit():
                continue
            districts[nces_id] = {
                "nces_id": nces_id,
                "name": tidy(pick(row, "name") or "")[:200],
                "city": tidy(pick(row, "city") or "")[:100],
                "state": (pick(row, "state") or "").upper()[:2],
                "zip": zip_code,
            }
    return list(districts.values())


def upsert(connection, rows: list[dict]) -> None:
    for start in range(0, len(rows), BATCH):
        statement = insert(District).values(rows[start:start + BATCH])
        statement = statement.on_conflict_do_update(
            index_elements=[District.nces_id],
            set_={column: statement.excluded[column] for column in ("name", "city", "state", "zip")},
        )
        connection.execute(statement)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    rows = read_districts(Path(sys.argv[1]))
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:  # one transaction: all rows or none
        upsert(connection, rows)
    print(f"loaded {len(rows)} districts")


if __name__ == "__main__":
    main()
