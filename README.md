# Clark County Tax Auction Tracker

A live, auto-updating dashboard for the Clark County, Nevada **delinquent real property tax auction**, built from the public data on the [County Treasurer's auction site](https://treasurer.clarkcountynv.gov/auction).

**Live dashboard:** https://shamarrobinson.github.io/clark-county-tax-auction-dashboard/

## What it shows

Pick any auction (or all of them since 2012) and see:

- **Average winning bid**, parcels sold, total bids, bidding wars and excess proceeds
- **Cost tiers:** parcels grouped by amount owed (minimum bid) with the average winning bid per tier
- **Parcel types:** vacant land, single-family, condo/townhouse, manufactured, multi-family, commercial (Assessor land-use codes)
- **Location:** map of every parcel plus average winning bid and bidding-war rate by area
- **Parcel location lookup:** the correct site address (or nearest street for unaddressed land) for every parcel, linked straight to the county's OpenWeb map
- **Bidding wars:** how many parcels sold above the minimum and the biggest jumps
- **Time in default:** estimated years taxes went unpaid (county trustee date + the 3 years required first), how long former owners held the parcels, and how long excess proceeds have gone unclaimed

## How it stays current

```
County Treasurer site ──(weekly)──> GitHub Action runs fetch_data.py
                                             └─ writes auctions.json, commits it
GitHub Pages serves index.html ──> browser loads auctions.json and renders
                                   (open pages re-check for new data every 30 minutes)
```

- `enrich.py` looks up each new parcel on the Clark County Assessor site (land use, town, coordinates, ownership history) and caches it in `parcels.json`.
- `fetch_data.py` reads the auction id from the county page, then calls the same JSON endpoints the county page uses (`Event_Read`, `WinningBid_Read`, `ParcelNumberGroup_Read`) for every auction on record. Python standard library only.
- `.github/workflows/update-data.yml` runs weekly (Mondays) and on demand (**Actions → Update auction data → Run workflow**). If the county site is down or returns nothing, the previous data is kept.
- The page is plain HTML/CSS/JS with [Chart.js](https://www.chartjs.org/); no build step.

## Auction alerts

`notify.py` runs after each weekly refresh. When the county posts an upcoming auction date it emails an announcement, then one reminder per week until the sale. Recipients and the sending account are stored only as encrypted repository secrets (`ALERT_TO`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_HOST` / `SMTP_PORT`), never in the code. To test: **Actions > Update auction data > Run workflow**, check "Send a test alert email".

## Run locally

```bash
python3 fetch_data.py
python3 -m http.server 8000   # then open http://localhost:8000
```

## Notes

Informational only and not affiliated with Clark County. "No street address" means the county lists the location as unassigned, which usually indicates vacant land. Verify details with the [Treasurer's office](https://www.clarkcountynv.gov/government/elected_officials/county_treasurer).
