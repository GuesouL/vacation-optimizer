"""The monthly reminder's content: PTO left plus next month's best breaks."""

from datetime import date

import httpx
import pytest
from conftest import YEAR_START, sign_in
from test_sharing import owner_with_group

from vacation_optimizer import trips
from vacation_optimizer.api import app
from vacation_optimizer.db import get_session
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
        "Open Pat's plan to save one.\n\n"
        "You get this because you turned on monthly reminders in Settings. Turn them off there any time."
    )


def test_digest_text_says_so_when_nothing_fits():
    empty = DigestOut(month="March 2027", people=[], breaks=[], free_weekends=[])
    assert "No good breaks start in March 2027" in digest_text(empty, "Our plan")[1]


# --- Sending -----------------------------------------------------------------

from sqlalchemy import select  # noqa: E402

from vacation_optimizer import mailer, orm  # noqa: E402
from vacation_optimizer.reminders import send_due  # noqa: E402


class Outbox:
    """Stands in for the email service: remembers what would have been sent."""

    def __init__(self, fail_for=()):
        self.sent, self.fail_for = [], fail_for

    def __call__(self, to, subject, text):
        if to in self.fail_for:
            raise RuntimeError("bad address")
        self.sent.append((to, subject, text))


def db(client):
    return app.dependency_overrides[get_session]()


def test_reminders_are_off_until_you_turn_them_on(client):
    assert client.get("/me").json()["reminders_on"] is False
    owner_with_group(client)
    assert send_due(db(client), YEAR_START, outbox := Outbox()).sent == 0 and outbox.sent == []
    assert client.put("/me/reminders", json={"enabled": True}).json() == {"enabled": True}
    assert client.get("/me").json()["reminders_on"] is True


def test_send_due_emails_once_per_month(client):
    owner_with_group(client)
    client.put("/me/reminders", json={"enabled": True})
    outbox = Outbox()
    assert send_due(db(client), YEAR_START, outbox).sent == 1
    to, subject, body = outbox.sent[0]
    assert to == "parent@example.com" and "October 2026" in subject
    assert "Pat Smith 10" in body and "Settings" in body
    assert send_due(db(client), YEAR_START, outbox).sent == 1 - 1  # same month: nothing more
    assert len(outbox.sent) == 1
    assert send_due(db(client), date(2026, 10, 15), outbox).sent == 1  # a new month: sent again


def test_a_failed_send_is_retried_and_does_not_block_others(client):
    owner_with_group(client)
    client.put("/me/reminders", json={"enabled": True})
    sign_in(client, "lee@example.com")
    lee = client.post("/people", json={"name": "Lee", "kind": "ADULT", "pto_balance": 5, "is_self": True}).json()["id"]
    client.post(f"/people/{lee}/calendars", json={"calendar_id": 1})
    client.post("/groups", json={"name": "Lee plan", "person_ids": [lee]})
    client.put("/me/reminders", json={"enabled": True})

    flaky = Outbox(fail_for=("parent@example.com",))
    result = send_due(db(client), YEAR_START, flaky)
    assert (result.sent, result.failed) == (1, 1) and flaky.sent[0][0] == "lee@example.com"
    # The failure wasn't recorded as sent, so the next run picks it up.
    assert send_due(db(client), YEAR_START, retry := Outbox()).sent == 1 and retry.sent[0][0] == "parent@example.com"


def test_the_monthly_endpoint_needs_the_secret(client, monkeypatch):
    sent = Outbox()
    monkeypatch.setattr(mailer, "send_email", sent)
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert client.post("/internal/send-reminders").status_code == 500  # no secret configured: closed
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    assert client.post("/internal/send-reminders").status_code == 401
    assert client.post("/internal/send-reminders", headers={"Authorization": "Bearer nope"}).status_code == 401
    ok = client.post("/internal/send-reminders", headers={"Authorization": "Bearer cron-secret"})
    assert ok.status_code == 200 and ok.json() == {"sent": 0, "failed": 0, "errors": []}


def test_email_needs_configuration(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(mailer.EmailNotConfigured):
        mailer.send_email("a@b.c", "hi", "body")


def test_the_monthly_endpoint_goes_red_when_a_send_fails(client, monkeypatch):
    owner_with_group(client)
    client.put("/me/reminders", json={"enabled": True})
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    monkeypatch.setattr(mailer, "send_email", Outbox(fail_for=("parent@example.com",)))
    failed = client.post("/internal/send-reminders", headers={"Authorization": "Bearer cron-secret"})
    body = failed.json()
    assert failed.status_code == 502 and (body["sent"], body["failed"]) == (0, 1)
    assert body["errors"][0].endswith("bad address")  # the reason reaches the job log


def test_resend_errors_keep_their_explanation(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("REMINDER_FROM", "App <onboarding@resend.dev>")
    refusal = httpx.Response(403, text="You can only send testing emails to your own email address", request=httpx.Request("POST", mailer.RESEND_URL))
    monkeypatch.setattr(mailer.httpx, "post", lambda *a, **k: refusal)
    with pytest.raises(RuntimeError, match="403.*only send testing emails"):
        mailer.send_email("a@b.c", "hi", "body")
