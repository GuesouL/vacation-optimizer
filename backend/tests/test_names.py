"""Look-alike names. Results are keyed by name, so labels must never collide."""

from datetime import date

import pytest
from test_api import adult, group, windows

from vacation_optimizer.engine import find_windows
from vacation_optimizer.models import Person
from vacation_optimizer.search import public_names, unique_labels

OCTOBER = {"start": "2026-10-01", "end": "2026-10-31"}


def first_costs(client, *people):
    return windows(client, group(client, *people), **OCTOBER)["windows"][0]["pto_cost"]


@pytest.mark.parametrize("names, labels", [
    (["Sam", "Lee"], ["Sam", "Lee"]),  # nothing to do
    (["Sam", "Sam"], ["Sam (1)", "Sam (2)"]),  # numbered in list order, not by database id
    (["Sam", "sam"], ["Sam (1)", "sam (2)"]),  # different case still looks like the same person
    (["Sam", "Sam", "Sam (1)"], ["Sam (1) (1)", "Sam (2)", "Sam (1) (2)"]),  # a name that looks like a label
])
def test_unique_labels(names, labels):
    assert unique_labels(names) == labels
    assert len({label.casefold() for label in labels}) == len(labels)


@pytest.mark.parametrize("names, labels", [
    (["Sam Smith", "Lee Jones"], ["Sam", "Lee"]),
    (["Sam Smith", "Sam Jones"], ["Sam S.", "Sam J."]),  # last initial, never an id
    (["Sam Smith", "Sam Stone"], ["Sam S. (1)", "Sam S. (2)"]),
    (["Sam", "Sam"], ["Sam (1)", "Sam (2)"]),
])
def test_public_names(names, labels):
    assert public_names(names) == labels


def test_twins_are_numbered(client):
    assert set(first_costs(client, adult(client, "Sam", 10), adult(client, "Sam", 10))) == {"Sam (1)", "Sam (2)"}


def test_names_are_trimmed(client):
    sam = client.post("/people", json={"name": "  Sam  ", "kind": "ADULT", "pto_balance": 5}).json()
    assert sam["name"] == "Sam"
    blank = client.post("/people", json={"name": "   ", "kind": "ADULT", "pto_balance": 5})
    assert blank.status_code == 422


def test_nobody_disappears_when_a_name_looks_like_a_label(client):
    """The bug: "Sam (#id)" relabeling could land on a real person's name and
    overwrite them, so their schedule silently dropped out of the search."""
    a, b, c = adult(client, "Sam", 10), adult(client, "Sam", 10), adult(client, "Sam (1)", 10)
    assert len(first_costs(client, a, b, c)) == 3


def test_view_link_uses_initials_not_ids(client):
    group_id = group(client, adult(client, "Sam Smith", 10), adult(client, "Sam Jones", 10))
    token = client.post(f"/groups/{group_id}/links", json={"kind": "VIEW"}).json()["token"]
    view = client.get(f"/links/{token}/view", params=OCTOBER).json()
    assert view["people"] == ["Sam S.", "Sam J."]
    assert set(view["search"]["windows"][0]["pto_cost"]) == {"Sam S.", "Sam J."}


def test_engine_refuses_repeated_names():
    twins = [Person("Sam", 5), Person("Sam", 5)]
    with pytest.raises(ValueError, match="different name"):
        find_windows(twins, date(2026, 10, 1), date(2026, 10, 31))
