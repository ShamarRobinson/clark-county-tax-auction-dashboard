#!/usr/bin/env python3
"""Add Assessor details to each auctioned parcel (town, land use, lot size, values,
former owner's purchase date). Results are cached in parcels.json so only parcels
not seen before are looked up. Standard library only."""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUCTIONS = HERE / "auctions.json"
CACHE = HERE / "parcels.json"
BASE = "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/"
UA = "Mozilla/5.0 (compatible; cc-tax-auction-dashboard/1.0)"


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                print(f"failed {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(2 * (i + 1))


def span(page, name):
    m = re.search(r'<span id="%s">(.*?)</span>' % name, page, re.S)
    return html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""


def num(s):
    s = re.sub(r"[^\d.]", "", s or "")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def history(apn_digits):
    page = get(f"{BASE}ParcelHistory.aspx?instance=pcl2&parcel={apn_digits}")
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        tds = re.findall(r'<td[^>]*title="([^"]*)"', tr)
        dates = re.findall(r'title="(\d{2}/\d{2}/\d{4})"', tr)
        if len(tds) >= 2 and dates:
            try:
                d = datetime.strptime(dates[0], "%m/%d/%Y").date().isoformat()
            except ValueError:
                continue
            rows.append({"owner": html.unescape(tds[1]).split('">')[-1].strip(), "date": d})
    return rows


def lookup(apn):
    digits = re.sub(r"\D", "", apn)
    page = get(f"{BASE}parceldetail.aspx?hdnParcel={digits}")
    if not page or "lblParcel" not in page:
        return None
    rec = {
        "town": span(page, "lblTown").title(),
        "situs": re.sub(r"\s+", " ", span(page, "lblLocation")),
        "legal": " ".join(x for x in (span(page, "lblDesc%d" % k) for k in range(1, 4)) if x),
        "landUse": span(page, "lblLandUse"),
        "acres": num(span(page, "lblAcres")),
        "yearBuilt": num(span(page, "lblConstrYr")),
        "taxDistrict": span(page, "lblTaxDist"),
        "assessed": num(span(page, "lblTAssessed1")),
        "taxable": num(span(page, "lblTTaxable1")),
        "valueYear": span(page, "lblFiscalYr1"),
        "sqft": num(span(page, "lblFirstFloor")),
        "history": history(digits),
        "fetched": datetime.utcnow().date().isoformat(),
    }
    return rec


GIS = "https://maps.clarkcountynv.gov/arcgis/rest/services/Assessor/Layers/MapServer/1/query?"
# Outlying communities (approximate centers) used to name parcels the Assessor lists without a town.
COMMUNITIES = {
    "Laughlin": (35.168, -114.573), "Searchlight": (35.465, -114.919), "Mesquite": (36.806, -114.067),
    "Moapa Valley": (36.580, -114.470), "Moapa": (36.680, -114.620), "Indian Springs": (36.570, -115.670),
    "Sandy Valley": (35.817, -115.632), "Goodsprings": (35.832, -115.434), "Primm": (35.610, -115.390),
    "Boulder City": (35.979, -114.832), "Blue Diamond": (36.046, -115.404), "Cal-Nev-Ari": (35.305, -114.884),
    "Bunkerville": (36.773, -114.128), "Mount Charleston": (36.270, -115.650), "Nelson": (35.708, -114.824),
}


def add_geo(cache):
    todo = [k for k, v in cache.items() if "lat" not in v]
    for i in range(0, len(todo), 80):
        chunk = todo[i:i + 80]
        where = "APN IN (%s)" % ",".join("'%s'" % re.sub(r"\D", "", a) for a in chunk)
        q = urllib.parse.urlencode({"where": where, "outFields": "APN", "returnGeometry": "true",
                                    "outSR": "4326", "geometryPrecision": "5", "f": "json"})
        try:
            data = json.loads(get(GIS + q) or "{}")
        except ValueError:
            continue
        found = {}
        for f in data.get("features", []):
            ring = (f.get("geometry") or {}).get("rings", [[]])[0]
            if ring:
                found[f["attributes"]["APN"]] = (round(sum(p[1] for p in ring) / len(ring), 5),
                                                 round(sum(p[0] for p in ring) / len(ring), 5))
        for a in chunk:
            ll = found.get(re.sub(r"\D", "", a))
            cache[a]["lat"], cache[a]["lon"] = ll if ll else (None, None)


def add_area(cache):
    """Area = the Assessor's town, or for parcels listed without one, the nearest named place."""
    known = [(v["lat"], v["lon"], v["town"]) for v in cache.values()
             if v.get("town") and v["town"] != "Clark County" and v.get("lat")]
    known += [(la, lo, n) for n, (la, lo) in COMMUNITIES.items()]
    for v in cache.values():
        if v.get("town") and v["town"] != "Clark County":
            v["area"] = v["town"]
        elif v.get("lat"):
            la, lo = v["lat"], v["lon"]
            best = min(known, key=lambda k: (k[0] - la) ** 2 + ((k[1] - lo) * 0.81) ** 2)
            dist_km = (((best[0] - la) ** 2 + ((best[1] - lo) * 0.81) ** 2) ** 0.5) * 111
            v["area"] = best[2] if dist_km < 15 else "Rural Clark County"
        else:
            v["area"] = "Unknown"


LOCATOR = "https://maps.clarkcountynv.gov/arcgis/rest/services/Locators/CC_MultiRole_pro/GeocodeServer/reverseGeocode?"


def has_street_number(s):
    return bool(re.match(r"^\s*\d*[1-9]\d*\s+\S", s or ""))


def add_location(cache):
    """Fill in a usable address: the Assessor's site address when it has one, otherwise the
    nearest street block from the county's reverse geocoder (marked approximate)."""
    def nearest(v):
        loc = json.dumps({"x": v["lon"], "y": v["lat"], "spatialReference": {"wkid": 4326}})
        q = urllib.parse.urlencode({"location": loc, "distance": 8000, "featureTypes": "StreetAddress", "outSR": 4326, "f": "json"})
        try:
            d = json.loads(get(LOCATOR + q, tries=2) or "{}")
        except ValueError:
            return None
        a, l = d.get("address") or {}, d.get("location") or {}
        if not a.get("Match_addr"):
            return None
        dist_ft = None
        if l.get("x") is not None:
            import math
            dy = (l["y"] - v["lat"]) * 364000
            dx = (l["x"] - v["lon"]) * 364000 * math.cos(math.radians(v["lat"]))
            dist_ft = int(round((dx * dx + dy * dy) ** 0.5, -1))
        return {"street": a["Match_addr"], "ft": dist_ft}

    todo = [k for k, v in cache.items() if "address" not in v]
    def work(k):
        v = cache[k]
        place = v.get("area") or v.get("town") or "Clark County"
        if has_street_number(v.get("situs")):
            return k, {"address": f"{v['situs'].title()}, {v.get('town') or place}, NV", "addressExact": True}
        if v.get("lat"):
            n = nearest(v)
            if n:
                near = f"Near {n['street']}, {place}, NV" + (f" (about {n['ft']:,} ft away)" if n.get("ft") else "")
                return k, {"address": near, "addressExact": False}
        if v.get("lat"):
            import math
            name, (cla, clo) = min(COMMUNITIES.items(), key=lambda kv: (kv[1][0] - v["lat"]) ** 2 + ((kv[1][1] - v["lon"]) * 0.81) ** 2)
            dy, dx = v["lat"] - cla, (v["lon"] - clo) * 0.81
            miles = ((dx * dx + dy * dy) ** 0.5) * 69
            compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((math.degrees(math.atan2(dx, dy)) + 360 + 22.5) % 360) // 45)]
            return k, {"address": f"Rural land about {miles:.1f} mi {compass} of {name}, NV ({v['lat']:.5f}, {v['lon']:.5f})", "addressExact": False}
        return k, {"address": f"No street address, {place}, NV", "addressExact": False}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for k, upd in ex.map(work, todo):
            cache[k].update(upd)


def main():
    data = json.loads(AUCTIONS.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    apns = sorted({p["apn"] for a in data["auctions"] for p in a["parcels"] if p.get("apn")})
    todo = [a for a in apns if a not in cache or "situs" not in cache[a]]
    print(f"{len(apns)} parcels, {len(todo)} to look up")
    with ThreadPoolExecutor(max_workers=4) as ex:
        for apn, rec in zip(todo, ex.map(lookup, todo)):
            if rec:
                keep = {k: cache.get(apn, {}).get(k) for k in ("lat", "lon") if cache.get(apn, {}).get(k) is not None}
                cache[apn] = {**rec, **keep}
    add_geo(cache)
    add_area(cache)
    add_location(cache)
    CACHE.write_text(json.dumps(dict(sorted(cache.items())), indent=0))
    print(f"cached {len(cache)} parcels")


if __name__ == "__main__":
    main()
