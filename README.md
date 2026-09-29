# Clark County Tax Auction Tracker

A live, auto-updating dashboard for the Clark County, Nevada **delinquent real property tax auction**, built from the public data on the [County Treasurer's auction site](https://treasurer.clarkcountynv.gov/auction).

**Live dashboard:** https://shamarrobinson.github.io/clark-county-tax-auction-dashboard/

## What it shows

- **Upcoming auction banner** with date, sessions, location and parcel list as soon as the county posts them (or an estimate of the next sale based on history)
- **Latest auction KPIs:** parcels sold, winning vs. minimum bids, amount bid up, excess proceeds, median bid multiple
- **Auto-generated insights** (recomputed on every data update): bidding competition vs. history, addressed properties vs. vacant land, owner concentration, high-balance parcels, long-run totals
- **Excess proceeds claim windows:** former owners can claim surplus within 1 year of deed recording ([NRS 361.610](https://www.clarkcountynv.gov/government/elected_officials/county_treasurer/excess-proceeds-claim-instructions)); the dashboard shows the dollar amount, deadline and days left
- **Trends across every auction on record (2012 onward):** parcels sold, dollars, median bid multiple, share sold at the minimum
- **Full parcel table** for any auction with search, filters, sorting, Assessor links and CSV download

## How it stays current

```
County Treasurer site ──(every 3 hours)──> GitHub Action runs fetch_data.py
                                             └─ writes auctions.json, commits it
GitHub Pages serves index.html ──> browser loads auctions.json and renders
                                   (open pages re-check for new data every 30 minutes)
```

- `fetch_data.py` reads the auction id from the county page, then calls the same JSON endpoints the county page uses (`Event_Read`, `WinningBid_Read`, `ParcelNumberGroup_Read`) for every auction on record. Python standard library only.
- `.github/workflows/update-data.yml` runs the script on a schedule and on demand (**Actions → Update auction data → Run workflow**). If the county site is down or returns nothing, the previous data is kept.
- The page is plain HTML/CSS/JS with [Chart.js](https://www.chartjs.org/); no build step.

## Run locally

```bash
python3 fetch_data.py
python3 -m http.server 8000   # then open http://localhost:8000
```

## Notes

Informational only and not affiliated with Clark County. "No street address" means the county lists the location as unassigned, which usually indicates vacant land. Verify details with the [Treasurer's office](https://www.clarkcountynv.gov/government/elected_officials/county_treasurer).
