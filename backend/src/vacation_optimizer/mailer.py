"""Sending email through Resend's HTTP API. One function, so a different provider
(or a fake in tests) only has to match `send_email`.

Why HTTP and not SMTP: Render's free tier blocks outgoing SMTP ports, while a plain
HTTPS request goes through like any other call."""

import os

import httpx

RESEND_URL = "https://api.resend.com/emails"


class EmailNotConfigured(RuntimeError):
    pass


def send_email(to: str, subject: str, text: str) -> None:
    key = os.environ.get("RESEND_API_KEY")
    sender = os.environ.get("REMINDER_FROM")
    if not key or not sender:
        # Fail loudly: a job that quietly "succeeds" while sending nothing is worse.
        raise EmailNotConfigured("Set RESEND_API_KEY and REMINDER_FROM on the server")
    response = httpx.post(
        RESEND_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={"from": sender, "to": [to], "subject": subject, "text": text},
        timeout=15,
    )
    if response.is_error:
        # Resend explains itself in the body ("you can only send to your own address"),
        # and raise_for_status() would throw that away, leaving only the status code.
        raise RuntimeError(f"Resend answered {response.status_code}: {response.text[:300]}")
