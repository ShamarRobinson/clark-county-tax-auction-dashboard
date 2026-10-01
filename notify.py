#!/usr/bin/env python3
"""Email alerts for upcoming Clark County tax auctions.

Runs after each weekly data refresh. When the county has posted an upcoming
auction date, it emails the recipients stored in repository secrets: the first
email announces the auction, and every weekly run after that sends a reminder
until the auction date passes.

Configuration comes only from environment variables (GitHub Actions secrets):
  ALERT_TO     comma-separated recipient list
  SMTP_USER    sending account
  SMTP_PASS    app password for the sending account
  SMTP_HOST    optional, default smtp.gmail.com
  SMTP_PORT    optional, default 465 (SSL)
Nothing about recipients is written to the repository or printed to logs.
"""
import json
import os
import smtplib
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")

HERE = Path(__file__).resolve().parent
DASHBOARD = "https://shamarrobinson.github.io/clark-county-tax-auction-dashboard/"
COUNTY = "https://treasurer.clarkcountynv.gov/auction"
STATE = HERE / "alert_state.json"  # remembers which auctions were already announced (ids only)


def parse(ts):
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def upcoming_auctions(data, now):
    out = []
    for a in data.get("auctions", []):
        starts = sorted(d for d in (parse(e.get("start")) for e in a.get("events", [])) if d)
        if starts and starts[-1] > now:
            out.append((a, starts))
    return out


def build(a, starts, now, first):
    first_day = starts[0].astimezone(PT)
    days = max(0, (first_day - now).days)
    when = first_day.strftime("%A, %B %-d, %Y")
    parcels = a.get("parcels", [])
    owed = sum(p.get("minBid") or 0 for p in parcels)
    sessions = "\n".join(
        f"  Session {e.get('no')}: {parse(e.get('start')).astimezone(PT).strftime('%B %-d at %-I:%M %p')} PT, {e.get('address') or 'location TBA'}"
        for e in a.get("events", []) if parse(e.get("start")))
    subject = (f"Clark County tax auction announced: {when}" if first
               else f"Reminder: Clark County tax auction in {days} days ({when})")
    body = f"""{'A new' if first else 'Weekly reminder: the'} Clark County delinquent property tax auction is scheduled for {when} ({days} days from now).

{sessions}

Parcels currently listed: {len(parcels) if parcels else 'not posted yet'}{f' (combined minimum bids about ${owed:,.0f})' if parcels else ''}
Parcels can drop off the list before the sale if owners pay what they owe.

Dashboard: {DASHBOARD}
County auction site (registration and rules): {COUNTY}

You will get one reminder a week until the auction date.
"""
    return subject, body


def main():
    now = datetime.now(timezone.utc)
    test = os.environ.get("ALERT_TEST") == "true"
    data = json.loads((HERE / "auctions.json").read_text())
    ups = upcoming_auctions(data, now)
    if not ups and not test:
        print("No upcoming auction posted; no email sent.")
        return

    to = [x.strip() for x in os.environ.get("ALERT_TO", "").split(",") if x.strip()]
    user, pw = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS")
    if not (to and user and pw):
        print("Upcoming auction found, but email secrets are not configured; skipping email.")
        return

    state = json.loads(STATE.read_text()) if STATE.exists() else {"announced": []}
    messages = []
    if ups:
        for a, starts in ups:
            first = a["id"] not in state["announced"]
            messages.append(build(a, starts, now, first))
            if first:
                state["announced"].append(a["id"])
    else:
        messages.append(("Test: Clark County tax auction alerts are working",
                         f"This is a test message. No upcoming auction is posted right now.\n\nDashboard: {DASHBOARD}\nCounty site: {COUNTY}\n"))

    host, port = os.environ.get("SMTP_HOST") or "smtp.gmail.com", int(os.environ.get("SMTP_PORT") or 465)
    with smtplib.SMTP_SSL(host, port, timeout=60) as s:
        s.login(user, pw)
        for subject, body in messages:
            msg = EmailMessage()
            msg["Subject"], msg["From"], msg["To"] = subject, user, user
            msg["Bcc"] = ", ".join(to)  # recipients stay hidden from each other
            msg.set_content(body)
            s.send_message(msg)
    STATE.write_text(json.dumps(state, indent=1))
    print(f"Sent {len(messages)} alert email(s) to {len(to)} recipient(s).")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never fail the data refresh because of email
        print(f"Email alert failed: {type(e).__name__}", file=sys.stderr)
