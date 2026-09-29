#!/usr/bin/env python3
"""Pull Clark County, NV delinquent real property tax auction data.

Source: https://treasurer.clarkcountynv.gov/auction (Clark County Treasurer).
The public page loads its tables from JSON endpoints; this script calls the
same endpoints for every auction on record and writes auctions.json.

Standard library only, so the GitHub Action needs no installs.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://treasurer.clarkcountynv.gov/auction"
OUT = Path(__file__).resolve().parent / "auctions.json"
UA = "Mozilla/5.0 (compatible; cc-tax-auction-dashboard/1.0; +https://github.com)"
LOOKAHEAD = 5  # auction ids to probe past the one the home page shows


def request(url, data=None, tries=4):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": UA,
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            print(f"retry {url}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))


def grid(endpoint, **params):
    q = urllib.parse.urlencode(params)
    txt = request(f"{BASE}/Auction/{endpoint}?{q}", {"page": 1, "pageSize": 5000})
    return json.loads(txt).get("Data") or []


def clean_addr(s):
    s = re.sub(r"<br\s*/?>", " ", s or "", flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def main():
    home = request(BASE)
    ids = [int(x) for x in re.findall(r"auctionId=(\d+)", home)]
    current = max(ids) if ids else 21
    print(f"home page auctionId={current}")

    auctions = []
    for aid in range(1, current + LOOKAHEAD + 1):
        events = grid("Event_Read", auctionId=aid)
        parcels = grid("WinningBid_Read", auctionId=aid)
        if not events and not parcels:
            continue
        groups = sorted({p["GroupParcelNumber"] for p in parcels if p.get("GroupParcelNumber")})
        group_members = {}
        for g in groups:
            try:
                group_members[g] = [m.get("ParcelNumber") for m in grid(
                    "ParcelNumberGroup_Read", auctionId=aid, parcelNumberGroup=g)]
            except Exception as e:  # noqa: BLE001
                print(f"group {g} failed: {e}", file=sys.stderr)
        auctions.append({
            "id": aid,
            "isCurrent": aid == current,
            "events": [{
                "no": e.get("EventNo"),
                "start": e.get("EventDateTimeStart"),
                "end": e.get("EventDateTimeEnd"),
                "status": e.get("EventStatus"),
                "type": e.get("EventType"),
                "address": clean_addr(e.get("Address")),
            } for e in events],
            "parcels": [{
                "apn": (p.get("ShowParcelNumber") or p.get("ParcelNumber") or "").replace("#", "").strip(),
                "owner": re.sub(r"\s+,", ",", (p.get("Owner") or "").strip()),
                "location": (p.get("PropertyLocation") or "").strip(),
                "minBid": p.get("MinBidAmount"),
                "winningBid": p.get("WinningBidAmount"),
                "excess": p.get("ExcessProceedAmount"),
                "deedRecorded": (p.get("DeedRecordingDate") or "")[:10] or None,
                "personalPropertyExcluded": str(p.get("IsPersonalPropertyNotIncluded")).lower() == "true",
                "group": p.get("GroupParcelNumber"),
                "description": p.get("AssessorDescription"),
            } for p in parcels],
            "groups": group_members,
        })
        print(f"auction {aid}: {len(events)} events, {len(parcels)} parcels")

    if not auctions or not any(a["parcels"] or a["events"] for a in auctions):
        sys.exit("No data returned; keeping the previous file.")

    new_payload = {"source": BASE, "currentAuctionId": current, "auctions": auctions}
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text())
        except Exception:  # noqa: BLE001
            old = {}
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    old_core = {k: old.get(k) for k in ("source", "currentAuctionId", "auctions")}
    changed = old_core != new_payload
    new_payload["lastChecked"] = now
    new_payload["lastChanged"] = now if changed or not old.get("lastChanged") else old["lastChanged"]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(new_payload, indent=1))
    print("data changed" if changed else "no change in source data")


if __name__ == "__main__":
    main()
