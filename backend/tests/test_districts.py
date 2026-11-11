"""Finding a school district by typing: name, city, ZIP, close spellings, and the import script."""

import importlib.util
from pathlib import Path

from vacation_optimizer.api import app
from vacation_optimizer.db import get_session

BACKEND = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("import_districts", BACKEND / "scripts" / "import_districts.py")
import_districts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_districts)

FIXTURE = BACKEND / "tests" / "fixtures" / "districts.csv"


def load_fixture():
    """Run the real import on a small sample of the federal file, inside the test's transaction."""
    session = app.dependency_overrides[get_session]()
    import_districts.upsert(session.connection(), import_districts.read_districts(FIXTURE))
    session.flush()


def names(client, **params):
    response = client.get("/districts", params=params)
    assert response.status_code == 200, response.text
    return [d["name"] for d in response.json()]


def test_import_keeps_school_districts_and_tidies_names():
    rows = {r["nces_id"]: r for r in import_districts.read_districts(FIXTURE)}
    assert rows["3605760"]["name"] == "Brentwood UFSD"  # ALL CAPS tidied, acronym kept
    assert rows["3605760"]["city"] == "Brentwood"
    assert rows["3622500"]["name"] == "Patchogue-Medford UFSD"
    assert rows["0803360"]["nces_id"] == "0803360"  # leading zero a spreadsheet dropped
    assert rows["3620580"]["zip"] == "10007"  # ZIP+4 cut to five digits
    assert "4800013" not in rows  # a service agency, not a district kids attend
    assert "0800001" not in rows  # closed
    assert "4700099" in rows  # charter districts count


def test_reimport_updates_instead_of_duplicating(client):
    load_fixture()
    load_fixture()
    assert names(client, q="11717") == ["Brentwood UFSD"]
    # NYC was seeded by the migration with its calendar; the import updated that same row.
    nyc = client.get("/districts", params={"q": "new york city"}).json()
    assert len(nyc) == 1
    assert nyc[0]["calendar"]["name"] == "NYC Public Schools 2026-27"
    assert nyc[0]["calendar"]["school_year"] == "2026-27"


def test_search_by_name_city_zip_and_typo(client):
    load_fixture()
    assert names(client, q="brentwood")[:2] == ["Brentwood Middle Charter", "Brentwood UFSD"]
    assert names(client, q="patchogue") == ["Patchogue-Medford UFSD"]
    assert names(client, q="medford") == ["Patchogue-Medford UFSD"]  # middle of the name
    assert names(client, q="11772") == ["Patchogue-Medford UFSD"]  # ZIP
    assert "Denver County 1" in names(client, q="denver")  # city
    assert "Brentwood UFSD" in names(client, q="brentwod")  # one letter missing


def test_state_narrows_the_results(client):
    load_fixture()
    assert names(client, q="brentwood", state="ny") == ["Brentwood UFSD"]
    assert names(client, q="brentwood", state="TN") == ["Brentwood Middle Charter"]


def test_districts_without_a_calendar_say_so(client):
    load_fixture()
    [brentwood] = client.get("/districts", params={"q": "11717"}).json()
    assert brentwood["calendar"] is None
    assert brentwood["state"] == "NY"


def test_search_input_is_checked(client):
    assert client.get("/districts", params={"q": "a"}).status_code == 422  # too short to be useful
    assert client.get("/districts", params={"q": "brentwood", "state": "New York"}).status_code == 422
    assert client.get("/districts", params={"q": "100%"}).status_code == 200  # wildcards are escaped
