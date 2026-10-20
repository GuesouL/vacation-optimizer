"""The monthly reminder's content: PTO left plus next month's best breaks."""

from datetime import date

import pytest
from conftest import YEAR_START, sign_in
from test_sharing import owner_with_group

from vacation_optimizer import trips
from vacation_optimizer.api import app
from vacation_optimizer.reminders import DigestOut, PersonPTO, digest_text, next_month
from vacation_optimizer.schemas import WindowOut


@pytest.fixture(autouse=True)
def pinned_today(client):
    app.dependency_overrides[trips.today] = lambda: YEAR_START  # Sep 10, 2026


def test_next_month_handles_month_lengths_and_new_year():
    assert next_month(date(2026, 1, 31)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert next_month(date(2026, 12, 15)) == (date(2027, 1, 1), date(2027, 1, 31))
    assert next_month(date(2027, 3, 1)) == (date(2027, 4, 1), date(2027, 4, 30))


def test_digest_lists_pto_left_and_breaks_starting_next_month(client):
    _, group_id = owner_with_group(client)  # 10 PTO, federal holidays
    response = client.get(f"/groups/{group_id}/digest")
    assert response.status_code == 200, response.text
    digest = response.json()

    assert digest["month"] == "October 2026"
    assert digest["people"] == [{"name": "Pat Smith", "pto_left": 10}]
    assert 0 < len(digest["breaks"]) <= 3
    assert all("2026-10-01" <= w["start"] <= "2026-10-31" for w in digest["breaks"] + digest["free_weekends"])
    # Columbus Day weekend (Sat Oct 10 - Mon Oct 12) needs no PTO.
    assert any(w["start"] == "2026-10-10" and w["end"] == "2026-10-12" for w in digest["free_weekends"])


def test_digest_is_private_to_the_plan(client):
    _, group_id = owner_with_group(client)
    sign_in(client, "stranger@example.com")
    assert client.get(f"/groups/{group_id}/digest").status_code == 404


def window(start, end, days, cost):
    return WindowOut(start=start, end=end, days=days, pto_cost={"Pat": cost}, score=None)


def test_digest_text_reads_like_a_short_note():
    digest = DigestOut(
        month="November 2026",
        people=[PersonPTO(name="Pat", pto_left=8)],
        breaks=[window(date(2026, 11, 26), date(2026, 11, 29), 4, 1)],
        free_weekends=[window(date(2026, 11, 7), date(2026, 11, 9), 3, 0)],
    )
    subject, body = digest_text(digest, "Pat's plan")
    assert subject == "November 2026: your best days off"
    assert body == (
        "PTO days left: Pat 8.\n\n"
        "Best breaks starting in November 2026:\n"
        "• Nov 26 – Nov 29: 4 days off for 1 PTO day\n"
        "Long weekends with no PTO needed:\n"
        "• Nov 7 – Nov 9\n\n"
        "Open Pat's plan to save one."
    )


def test_digest_text_says_so_when_nothing_fits():
    empty = DigestOut(month="March 2027", people=[], breaks=[], free_weekends=[])
    assert "No good breaks start in March 2027" in digest_text(empty, "Our plan")[1]
