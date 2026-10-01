/* Clark County Tax Auction Tracker: renders auctions.json + parcels.json (both refreshed by a GitHub Action). */
(function () {
  "use strict";
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => n == null || isNaN(n) ? "n/a" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const short = (n) => { if (n == null || isNaN(n)) return "n/a"; const a = Math.abs(n); return a >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : a >= 1e4 ? "$" + Math.round(n / 1e3) + "K" : money(n); };
  const pct = (x) => isFinite(x) ? Math.round(x * 100) + "%" : "n/a";
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
  const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const toDate = (d) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00-07:00" : d);
  const fmtDate = (d, o) => d ? toDate(d).toLocaleDateString("en-US", Object.assign({ month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }, o || {})) : "n/a";
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const apnLink = (apn) => `<a href="https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=${apn.replace(/\D/g, "")}" target="_blank" rel="noopener">${esc(apn)}</a>`;

  const TIERS = [[0, 1500, "Under $1.5K"], [1500, 3000, "$1.5K to $3K"], [3000, 7500, "$3K to $7.5K"], [7500, 15000, "$7.5K to $15K"], [15000, 40000, "$15K to $40K"], [40000, 100000, "$40K to $100K"], [100000, Infinity, "$100K and up"]];
  const TYPES = ["Vacant land", "Single-family home", "Condo or townhouse", "Manufactured home", "Multi-family (2 to 4 units)", "Commercial or industrial", "Other or unknown"];
  function typeOf(lu) {
    const code = parseFloat(lu);
    if (isNaN(code)) return "Other or unknown";
    if (code >= 10 && code < 20) return "Vacant land";
    if (code >= 20 && code < 21) return "Single-family home";
    if ((code >= 21 && code < 22) || (code >= 24 && code < 25)) return "Condo or townhouse";
    if (code >= 22 && code < 24) return "Manufactured home";
    if (code >= 30 && code < 40) return "Multi-family (2 to 4 units)";
    if (code >= 40 && code < 60) return "Commercial or industrial";
    return "Other or unknown";
  }

  let RAW = null, AUCTIONS = [], charts = [], map = null, layer = null;

  function prep(raw, info) {
    AUCTIONS = raw.auctions.map((a) => {
      const date = a.events.map((e) => e.start).filter(Boolean).sort()[0] || null;
      const parcels = a.parcels.map((p) => {
        const i = info[p.apn] || {};
        const refDate = p.deedRecorded || (date || "").slice(0, 10);
        const hist = (i.history || []).filter((h) => h.date < refDate).sort((x, y) => x.date.localeCompare(y.date));
        const isTrustee = (h) => /TREASURER|TRUSTEE CLARK COUNTY/i.test(h.owner);
        const last = hist[hist.length - 1];
        const trust = last && isTrustee(last) && last.date > "1950" ? last : null; // county must be the most recent titleholder
        const prior = hist.filter((h) => !isTrustee(h) && (!trust || h.date < trust.date)).pop();
        const yrs = (a, b) => (toDate(b) - toDate(a)) / (365.25 * DAY);
        const tenure = prior ? yrs(prior.date, trust ? trust.date : refDate) : null;
        const inTrust = trust && yrs(trust.date, refDate) < 40 ? yrs(trust.date, refDate) : null;
        return Object.assign({}, p, {
          auctionId: a.id, auctionDate: date,
          sold: p.winningBid > 0, war: p.winningBid > p.minBid + 0.01,
          multiple: p.winningBid && p.minBid ? p.winningBid / p.minBid : null,
          type: i.landUse ? typeOf(i.landUse) : "Other or unknown", landUse: i.landUse || "",
          area: i.area || "Unknown", town: i.town || "", address: i.address || "", addressExact: !!i.addressExact, legal: i.legal || "", lat: i.lat, lon: i.lon, acres: i.acres, taxable: i.taxable, yearBuilt: i.yearBuilt, sqft: i.sqft, taxDistrict: i.taxDistrict, tenure, inTrust,
          trustDate: trust ? trust.date : null, defaultYrs: inTrust != null ? inTrust + 3 : null,
        });
      });
      const upcoming = a.events.some((e) => e.start && toDate(e.start) > Date.now() - DAY / 2);
      return { id: a.id, date, events: a.events, parcels, upcoming, deed: parcels.map((p) => p.deedRecorded).filter(Boolean).sort()[0] };
    }).filter((a) => a.date).sort((x, y) => x.date.localeCompare(y.date));
    // prior appearances, status and deal score
    const seen = {};
    AUCTIONS.forEach((a) => a.parcels.forEach((p) => {
      p.priorAuctions = (seen[p.apn] || []).length;
      p.priorDates = (seen[p.apn] || []).slice();
      (seen[p.apn] = seen[p.apn] || []).push(fmtDate(a.date, { month: "short", day: undefined }));
      p.status = p.sold ? "Sold" : (a.upcoming ? "Upcoming" : "Not sold");
      Object.assign(p, dealScore(p));
    }));
  }

  function selected() {
    const v = $("fAuction").value;
    if (v === "all") return { label: "all auctions since " + toDate(AUCTIONS[0].date).getFullYear(), parcels: AUCTIONS.flatMap((a) => a.parcels), auctions: AUCTIONS.filter((a) => a.parcels.length), all: true };
    const a = AUCTIONS.find((x) => String(x.id) === v);
    return { label: "the " + fmtDate(a.date, { month: "long" }) + " auction", parcels: a.parcels, auctions: [a], all: false };
  }

  function render() {
    const S = selected();
    const sold = S.parcels.filter((p) => p.sold);
    renderKpis(S, sold);
    renderTiers(sold);
    renderTypes(sold);
    renderAreas(sold);
    renderWars(sold);
    renderTenure(S, sold);
      drawTable();
  }

  function renderKpis(S, sold) {
    const k = (label, value, note, hero) => `<div class="kpi${hero ? " hero" : ""}"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note || ""}</div></div>`;
    const bids = sold.map((p) => p.winningBid).filter((v) => v > 0);
    if (!bids.length) { $("kpis").innerHTML = k("Parcels sold", "0", ""); return; }
    const lo = sold.reduce((a, p) => (p.winningBid > 0 && (!a || p.winningBid < a.winningBid) ? p : a), null);
    const hi = sold.reduce((a, p) => (!a || p.winningBid > a.winningBid ? p : a), null);
    const modeOf = (vals) => { const m = new Map(); vals.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]; };
    let [mv, mc] = modeOf(bids), mnote;
    if (mc > 1) mnote = `${mc} parcels sold for exactly this`;
    else { [mv, mc] = modeOf(bids.map((v) => Math.round(v / 500) * 500)); mnote = mc > 1 ? `About this (nearest $500): ${mc} parcels` : "Every bid was different"; }
    const who = (p) => `<a href="#" data-apn="${esc(p.apn)}" class="kpilink">${esc(p.apn)}</a>${p.area && p.area !== "Unknown" ? ", " + esc(p.area) : ""}`;
    $("kpis").innerHTML = [
      k("Parcels sold", sold.length.toLocaleString(), S.all ? `${S.auctions.length} auctions` : ""),
      k("Average winning bid", money(avg(bids)), "Mean of all winning bids", true),
      k("Median winning bid", money(med(bids)), "Half sold above, half below"),
      k("Lowest winning bid", money(lo.winningBid), who(lo)),
      k("Highest winning bid", money(hi.winningBid), who(hi)),
      k("Most frequent bid", money(mv), mnote),
    ].join("");
    $("kpis").querySelectorAll(".kpilink").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const p = sold.find((x) => x.apn === a.dataset.apn); if (p) showDetail(p); }));
  }

  /* ---------- charts ---------- */
  function barOpts(fmt, horizontal) {
    const t = cssVar("--text-2"), g = cssVar("--grid");
    const val = { beginAtZero: true, grid: { color: g }, border: { display: false }, ticks: { color: t, font: { size: 11 }, callback: (v) => fmt(v) } };
    const cat = { grid: { display: false }, border: { color: g }, ticks: { color: t, font: { size: 11 }, autoSkip: false } };
    return {
      responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? "y" : "x",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(horizontal ? c.parsed.x : c.parsed.y)}` } } },
      scales: horizontal ? { x: val, y: cat } : { x: cat, y: val },
    };
  }
  const bar = (label, data, color, horizontal) => ({ label, data, backgroundColor: color, borderWidth: 0, maxBarThickness: 34, borderSkipped: horizontal ? "left" : "bottom", borderRadius: horizontal ? { topRight: 4, bottomRight: 4 } : { topLeft: 4, topRight: 4 } });
  function chart(id, cfg) { const c = new Chart($(id), cfg); charts.push(c); return c; }

  function groupRows(sold, key, order) {
    const groups = {};
    sold.forEach((p) => (groups[key(p)] = groups[key(p)] || []).push(p));
    const names = order ? order.filter((n) => groups[n]) : Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    return names.map((n) => {
      const g = groups[n];
      return { name: n, n: g.length, avgMin: avg(g.map((p) => p.minBid)), avgWin: avg(g.map((p) => p.winningBid)), mult: med(g.map((p) => p.multiple)), war: g.filter((p) => p.war).length / g.length, total: sum(g.map((p) => p.winningBid)) };
    });
  }
  function statTable(id, rows, first) {
    $(id).innerHTML = `<thead><tr><th>${first}</th><th class="num">Parcels</th><th class="num">Avg owed</th><th class="num">Avg winning bid</th><th class="num">Median multiple</th><th class="num">Bidding wars</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="arearow" tabindex="0" data-area="${esc(r.name)}" title="Click to highlight on the map"><td><span class="areaname">${esc(r.name)}</span></td><td class="num">${r.n}</td><td class="num">${money(r.avgMin)}</td><td class="num"><b>${money(r.avgWin)}</b></td><td class="num">${r.mult ? r.mult.toFixed(1) + "x" : ""}</td><td class="num">${pct(r.war)}</td></tr>`).join("") + "</tbody>";
  }

  function renderTiers(sold) {
    const rows = groupRows(sold, (p) => (TIERS.find((t) => p.minBid >= t[0] && p.minBid < t[1]) || TIERS[0])[2], TIERS.map((t) => t[2]));
    statTable("tTiers", rows, "Amount owed");
    chart("cTiers", { type: "bar", data: { labels: rows.map((r) => r.name), datasets: [bar("Average owed", rows.map((r) => r.avgMin), cssVar("--s1")), bar("Average winning bid", rows.map((r) => r.avgWin), cssVar("--s2"))] },
      options: (() => { const o = Object.assign(barOpts(short), { plugins: Object.assign(barOpts(short).plugins, { legend: { display: true, labels: { boxWidth: 10, color: cssVar("--text-2") } } }) });
        o.scales = Object.assign({}, o.scales, { y: Object.assign({}, o.scales && o.scales.y, { type: "logarithmic", ticks: Object.assign({}, o.scales && o.scales.y && o.scales.y.ticks, { callback: (v) => [1000, 10000, 100000, 1000000].includes(v) ? short(v) : "" }) }) });
        return o; })() });
    const withN = rows.filter((r) => r.n >= 2);
    const hot = withN.slice().sort((a, b) => b.mult - a.mult)[0], cold = withN.slice().sort((a, b) => a.war - b.war)[0];
    $("kTiers").innerHTML = hot && cold && hot !== cold ? `Parcels owing <b>${hot.name}</b> saw the strongest bidding, selling for a median <b>${hot.mult.toFixed(1)}x</b> what was owed (average winning bid ${money(hot.avgWin)}). Parcels owing <b>${cold.name}</b> drew the least competition: ${pct(cold.war)} had bidding wars and they sold for a median ${cold.mult.toFixed(1)}x.` : "";
  }

  function renderTypes(sold) {
    const rows = groupRows(sold, (p) => p.type, TYPES);
    statTable("tTypes", rows, "Parcel type");
    chart("cTypes", { type: "bar", data: { labels: rows.map((r) => r.name), datasets: [bar("Parcels", rows.map((r) => r.n), cssVar("--s1"), true)] }, options: barOpts((v) => Math.round(v), true) });
    const top = rows.slice().sort((a, b) => b.n - a.n)[0], rich = rows.slice().sort((a, b) => b.avgWin - a.avgWin)[0];
    if (top && rich) $("kTypes").innerHTML = `<b>${esc(top.name)}</b> is the most common type (${top.n} of ${sold.length}, ${pct(top.n / sold.length)}), averaging ${money(top.avgWin)}. <b>${esc(rich.name)}</b> parcels brought the highest average winning bid at <b>${money(rich.avgWin)}</b>.`;
  }

  function renderAreas(sold) {
    const rows = groupRows(sold, (p) => p.area);
    $("tAreas").innerHTML = `<thead><tr><th>Area</th><th class="num">Parcels</th><th class="num">Avg winning bid</th><th class="num">Median multiple</th><th class="num">Bidding wars</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="arearow" tabindex="0" data-area="${esc(r.name)}" title="Click to highlight on the map"><td><span class="areaname">${esc(r.name)}</span></td><td class="num">${r.n}</td><td class="num"><b>${money(r.avgWin)}</b></td><td class="num">${r.mult ? r.mult.toFixed(1) + "x" : ""}</td><td class="num">${pct(r.war)}</td></tr>`).join("") + "</tbody>";
    // Valley vs outlying comparison
    const VALLEY = ["Las Vegas", "North Las Vegas", "Henderson", "Paradise", "Sunrise Manor", "Spring Valley", "Enterprise", "Winchester", "Whitney", "Summerlin"];
    const inV = sold.filter((p) => VALLEY.includes(p.area)), out = sold.filter((p) => !VALLEY.includes(p.area) && p.area !== "Unknown");
    if (inV.length && out.length) {
      const vW = avg(inV.map((p) => p.winningBid)), oW = avg(out.map((p) => p.winningBid)), vWar = inV.filter((p) => p.war).length / inV.length, oWar = out.filter((p) => p.war).length / out.length;
      const topArea = rows.filter((r) => r.n >= 2).sort((a, b) => b.avgWin - a.avgWin)[0];
      $("kAreas").innerHTML = `<b>Las Vegas Valley</b> parcels (${inV.length}) averaged <b>${money(vW)}</b>, ${vW > oW ? (vW / Math.max(oW, 1)).toFixed(0) + "x" : "less than"} the <b>${money(oW)}</b> average for the ${out.length} parcels in outlying areas (Moapa Valley, Sandy Valley, Searchlight and others). Bidding wars happened on ${pct(vWar)} of valley parcels vs. ${pct(oWar)} outside it.${topArea ? ` Highest average among areas with 2+ parcels: <b>${esc(topArea.name)}</b> at ${money(topArea.avgWin)}.` : ""}`;
    }
    else $("kAreas").textContent = "";
    drawMap(sold);
    selArea = null;
    $("tAreas").querySelectorAll("tr.arearow").forEach((tr) => {
      const go = () => highlightArea(selArea === tr.dataset.area ? null : tr.dataset.area);
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $("areaClear").onclick = () => highlightArea(null);
  }

  let selArea = null, areaShape = null, markerList = [], allBounds = null;
  function hull(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (P.length < 3) return P;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function highlightArea(name) {
    selArea = name;
    $("tAreas").querySelectorAll("tr.arearow").forEach((tr) => tr.classList.toggle("sel", tr.dataset.area === name));
    $("areaClear").hidden = !name;
    $("areaNote").innerHTML = name ? `Showing <b>${esc(name)}</b> on the map.` : "Click an area to highlight it on the map.";
    if (!map) return;
    if (areaShape) { areaShape.remove(); areaShape = null; }
    const accent = cssVar("--s3");
    markerList.forEach(({ m, p }) => {
      const on = !name || p.area === name;
      m.setStyle({ fillOpacity: on ? 0.9 : 0.12, opacity: on ? 1 : 0.2, color: name && on ? cssVar("--text") : cssVar("--surface"), weight: name && on ? 1.5 : 1 });
      if (name && on) m.bringToFront();
    });
    if (!name) { if (allBounds) map.fitBounds(allBounds); return; }
    const pts = markerList.filter(({ p }) => p.area === name).map(({ p }) => [p.lat, p.lon]);
    if (!pts.length) return;
    const style = { color: accent, weight: 2, dashArray: "6 4", fillColor: accent, fillOpacity: 0.14, interactive: false };
    const h = hull(pts);
    if (h.length >= 3) {
      const c = [avg(h.map((x) => x[0])), avg(h.map((x) => x[1]))];
      areaShape = L.polygon(h.map(([la, lo]) => [c[0] + (la - c[0]) * 1.15 + Math.sign(la - c[0]) * 0.004, c[1] + (lo - c[1]) * 1.15 + Math.sign(lo - c[1]) * 0.005]), style).addTo(map);
    } else {
      const c = [avg(pts.map((x) => x[0])), avg(pts.map((x) => x[1]))];
      const r = Math.max(700, ...pts.map((x) => map.distance(c, x) + 500));
      areaShape = L.circle(c, Object.assign({ radius: r }, style)).addTo(map);
    }
    areaShape.bringToBack();
    map.fitBounds(areaShape.getBounds().pad(0.25), { maxZoom: 15 });
    document.getElementById("map").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function drawMap(sold) {
    if (typeof L === "undefined") return;
    if (!map) {
      map = L.map("map", { scrollWheelZoom: false }).setView([36.17, -115.14], 9);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 18 }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const pts = sold.filter((p) => p.lat);
    const maxW = Math.max(...pts.map((p) => p.winningBid), 1);
    if (areaShape) { areaShape.remove(); areaShape = null; }
    markerList = [];
    pts.forEach((p) => {
      const m = L.circleMarker([p.lat, p.lon], { radius: 4 + 12 * Math.sqrt(p.winningBid / maxW), color: cssVar("--surface"), weight: 1, fillColor: p.war ? cssVar("--s2") : cssVar("--s1"), fillOpacity: 0.85 })
        .bindPopup(`<b>${esc(p.apn)}</b><br>${esc(p.location)}<br>${esc(p.type)} &middot; ${esc(p.area)}<br>Owed ${money(p.minBid)}, won ${money(p.winningBid)}${p.war ? ` (${p.multiple.toFixed(1)}x)` : ""}<br>${fmtDate(p.auctionDate)}`)
        .addTo(layer);
      markerList.push({ m, p });
    });
    allBounds = pts.length ? L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.1) : null;
    if (allBounds) map.fitBounds(allBounds);
  }

  function renderWars(sold) {
    const wars = sold.filter((p) => p.war);
    const extra = sum(wars.map((p) => p.winningBid - p.minBid));
    const byType = groupRows(wars, (p) => p.type)[0];
    const st = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $("warStats").innerHTML = [
      st(`${wars.length} of ${sold.length}`, "parcels went to a bidding war"),
      st(med(wars.map((p) => p.multiple)) ? med(wars.map((p) => p.multiple)).toFixed(1) + "x" : "n/a", "median winning bid vs. amount owed, in bidding wars"),
      st(short(extra), "bid above what was owed"),
      st(byType ? esc(byType.name) : "n/a", byType ? `most common type in bidding wars (${byType.n})` : ""),
    ].join("");
    const top = wars.slice().sort((a, b) => b.multiple - a.multiple).slice(0, 8);
    $("tWars").innerHTML = `<thead><tr><th>Parcel</th><th>Type &middot; Area</th><th class="num">Owed</th><th class="num">Won</th><th class="num">Multiple</th></tr></thead><tbody>` +
      top.map((p) => `<tr><td>${apnLink(p.apn)}</td><td class="wrap">${esc(p.type)}<br><span class="muted small">${esc(p.area)}</span></td><td class="num">${money(p.minBid)}</td><td class="num">${money(p.winningBid)}</td><td class="num"><b>${p.multiple.toFixed(1)}x</b></td></tr>`).join("") + "</tbody>";
  }

  function renderTenure(S, sold) {
    const B = [[3, 4, "3 to 4 yrs"], [4, 5, "4 to 5 yrs"], [5, 7, "5 to 7 yrs"], [7, 10, "7 to 10 yrs"], [10, 999, "10+ yrs"]];
    const d = sold.map((p) => p.defaultYrs).filter((x) => x != null);
    const T = [[0, 5, "Under 5 yrs"], [5, 10, "5 to 10 yrs"], [10, 20, "10 to 20 yrs"], [20, 30, "20 to 30 yrs"], [30, 999, "30+ yrs"]];
    const ten = sold.map((p) => p.tenure).filter((x) => x != null && x >= 0);
    const useD = d.length >= 5, bins = useD ? B : T, vals = useD ? d : ten;
    $("tenureTitle").textContent = useD ? "Estimated years taxes went unpaid before the sale" : "How long the former owner held the parcel before losing it";
    chart("cTenure", { type: "bar", data: { labels: bins.map((b) => b[2]), datasets: [bar("Parcels", bins.map((b) => vals.filter((x) => x >= b[0] && x < b[1]).length), cssVar("--s3"))] }, options: barOpts((v) => Math.round(v)) });
    const now = Date.now();
    const rows = S.auctions.filter((a) => a.deed).slice().reverse().slice(0, S.all ? 6 : 1).map((a) => {
      const dl = toDate(a.deed); dl.setFullYear(dl.getFullYear() + 1);
      const days = Math.floor((now - toDate(a.deed)) / DAY), left = Math.ceil((dl - now) / DAY);
      const ex = sum(a.parcels.map((p) => p.excess));
      return `<tr><td>${fmtDate(a.date, { month: "short" })}</td><td class="num">${ex ? money(ex) : "n/a"}</td><td class="num">${days.toLocaleString()} days</td><td>${left > 0 ? `<span class="open">Open, ${left} days left</span>` : `<span class="closed">Closed ${fmtDate(dl)}</span>`}</td></tr>`;
    });
    $("tClaims").innerHTML = `<thead><tr><th>Auction</th><th class="num">Excess proceeds</th><th class="num">Since deed recorded</th><th>Claim window</th></tr></thead><tbody>${rows.join("")}</tbody>`;
    const t = sold.map((p) => p.tenure).filter((x) => x != null && x >= 0);
    const long = t.filter((x) => x >= 20).length, oldest = sold.filter((p) => p.defaultYrs != null).sort((a, b) => b.defaultYrs - a.defaultYrs)[0];
    $("kTenure").innerHTML = d.length ? `For the ${d.length} parcels with a recorded county trustee date, taxes had gone unpaid for an estimated <b>${med(d).toFixed(1)} years</b> (median) by the time of sale, including ${pct(d.filter((x) => x >= 5).length / d.length)} at 5+ years.${oldest ? ` Longest: ${apnLink(oldest.apn)} (${esc(oldest.type.toLowerCase())}, ${esc(oldest.area)}) at about <b>${Math.round(oldest.defaultYrs)} years</b>.` : ""}${t.length ? ` Former owners had held the median parcel for <b>${med(t).toFixed(0)} years</b> before losing it, and ${pct(long / t.length)} for 20+ years, which often points to inherited or forgotten land.` : ""}`
      : `Every parcel went at least <b>3 years</b> with unpaid taxes before it could be sold. Since about 2017 the county no longer records its trustee date on the Assessor's ownership history, so a longer estimate isn't possible for this auction (see earlier auctions or \"All auctions\", where the median was about ${med(AUCTIONS.flatMap((a) => a.parcels).map((p) => p.defaultYrs).filter((x) => x != null)).toFixed(1)} years).${t.length ? ` Former owners had held the median parcel for <b>${med(t).toFixed(0)} years</b> before the sale, and ${pct(long / t.length)} for 20+ years.` : ""}`;
  }

  /* ---------- deal score ---------- */
  const VALLEY_AREAS = ["Las Vegas", "North Las Vegas", "Henderson", "Paradise", "Sunrise Manor", "Spring Valley", "Enterprise", "Winchester", "Whitney", "Summerlin"];
  const clamp = (x) => Math.max(0, Math.min(1, x));
  function dealScore(p) {
    const price = p.sold ? p.winningBid : p.minBid;
    const ratio = p.taxable && price ? p.taxable / price : null;
    const value = ratio == null ? 0.25 : clamp((ratio - 0.5) / 2.5);
    const typePts = { "Multi-family (2 to 4 units)": 1, "Single-family home": 0.95, "Condo or townhouse": 0.8, "Manufactured home": 0.55, "Commercial or industrial": 0.5, "Vacant land": 0.3, "Other or unknown": 0.25 }[p.type] ?? 0.25;
    const loc = VALLEY_AREAS.includes(p.area) ? 1 : (p.area === "Unknown" ? 0.3 : 0.4);
    let sig = 0.5 + (p.addressExact ? 0.25 : 0) + (p.yearBuilt ? 0.25 : 0) - (p.personalPropertyExcluded ? 0.25 : 0) - (p.group ? 0.25 : 0);
    sig = clamp(sig);
    const comp = p.multiple == null ? 0.5 : clamp(1 - (p.multiple - 1) / 9);
    const parts = { value: Math.round(45 * value), type: Math.round(20 * typePts), location: Math.round(15 * loc), signals: Math.round(10 * sig), competition: Math.round(10 * comp) };
    const score = parts.value + parts.type + parts.location + parts.signals + parts.competition;
    const dealRating = score >= 70 ? "Strong" : score >= 50 ? "Good" : score >= 35 ? "Fair" : "Weak";
    return { dealScore: score, dealParts: parts, dealRating, valueRatio: ratio };
  }

  /* ---------- combined parcel grid (rows, column chooser, drag reorder, pivot) ---------- */
  const openWeb = (p) => "https://maps.clarkcountynv.gov/openweb/?@" + p.apn.replace(/\D/g, "");
  const gmaps = (p) => p.lat ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.address || p.location) + " Clark County NV")}`;
  const assessor = (p) => `https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=${p.apn.replace(/\D/g, "")}`;
  const tierOf = (p) => (TIERS.find((t) => p.minBid >= t[0] && p.minBid < t[1]) || TIERS[0])[2];
  const ratingPill = (p) => `<span class="pill r-${p.dealRating.toLowerCase()}">${p.dealScore} ${p.dealRating}</span>`;
  const GCOLS = {
    apn: { label: "Parcel", val: (p) => p.apn, html: (p) => `<a href="${openWeb(p)}" target="_blank" rel="noopener" title="Open on the County OpenWeb map">${esc(p.apn)}</a>` },
    auction: { label: "Auction", val: (p) => p.auctionDate || "", html: (p) => fmtDate(p.auctionDate, { month: "short", day: undefined }) },
    status: { label: "Status", val: (p) => p.status, html: (p) => `<span class="pill ${p.status === "Sold" ? "ok" : ""}">${p.status}</span>` },
    prior: { label: "Prior auctions", num: 1, val: (p) => p.priorAuctions, html: (p) => p.priorAuctions ? `${p.priorAuctions} <span class="muted small">(${esc(p.priorDates.join(", "))})</span>` : "None" },
    deal: { label: "Deal score", num: 1, val: (p) => p.dealScore, html: ratingPill },
    address: { label: "Correct address or location", wrap: 1, val: (p) => p.address || p.location, html: (p) => `${esc(p.address || p.location || "Not available")} ${p.address ? (p.addressExact ? "" : '<span class="pill">Approx.</span>') : ""}` },
    listed: { label: "Listed at auction", wrap: 1, val: (p) => p.location, html: (p) => `<span class="muted">${esc(p.location)}</span>` },
    area: { label: "Area", val: (p) => p.area, html: (p) => esc(p.area) },
    type: { label: "Type", val: (p) => p.type, html: (p) => esc(p.type) },
    owner: { label: "Former owner", wrap: 1, val: (p) => p.owner, html: (p) => esc(p.owner) },
    owed: { label: "Owed", num: 1, val: (p) => p.minBid, html: (p) => money(p.minBid) },
    won: { label: "Won", num: 1, val: (p) => p.sold ? p.winningBid : null, html: (p) => p.sold ? money(p.winningBid) : "" },
    multiple: { label: "Multiple", num: 1, val: (p) => p.multiple, html: (p) => p.multiple ? p.multiple.toFixed(1) + "x" : "" },
    value: { label: "Assessor value", num: 1, val: (p) => p.taxable, html: (p) => p.taxable ? money(p.taxable) : "" },
    unpaid: { label: "Yrs unpaid (est.)", num: 1, cond: 1, val: (p) => p.defaultYrs, html: (p) => p.defaultYrs != null ? p.defaultYrs.toFixed(1) : "" },
    excess: { label: "Excess", num: 1, val: (p) => p.excess || null, html: (p) => p.excess ? money(p.excess) : "" },
    links: { label: "Open in", nosort: 1, val: () => "", html: (p) => `<span class="links"><a href="${openWeb(p)}" target="_blank" rel="noopener">County map</a> &middot; <a href="${assessor(p)}" target="_blank" rel="noopener">Assessor</a> &middot; <a href="${gmaps(p)}" target="_blank" rel="noopener">Google Maps</a></span>` },
  };
  const DEFAULT_ORDER = ["apn", "auction", "status", "prior", "deal", "address", "area", "type", "owed", "won", "multiple", "unpaid", "excess", "links", "listed", "owner", "value"];
  const DEFAULT_HIDDEN = ["listed", "owner", "value"];
  const LS = "ccta-grid-v1";
  let G = { order: DEFAULT_ORDER.slice(), hidden: DEFAULT_HIDDEN.slice(), sort: "deal", dir: -1, pivot: "", pivotSort: "n", pivotDir: -1, filter: null };
  try { const saved = JSON.parse(localStorage.getItem(LS) || "null"); if (saved && Array.isArray(saved.order)) { G.order = saved.order.filter((k) => GCOLS[k]).concat(DEFAULT_ORDER.filter((k) => !saved.order.includes(k))); G.hidden = saved.hidden || G.hidden; } } catch (e) { /* storage unavailable */ }
  const saveG = () => { try { localStorage.setItem(LS, JSON.stringify({ order: G.order, hidden: G.hidden })); } catch (e) { /* ignore */ } };

  const PIVOTS = {
    dealRating: { label: "Deal rating", key: (p) => p.dealRating, order: ["Strong", "Good", "Fair", "Weak"] },
    type: { label: "Parcel type", key: (p) => p.type, order: TYPES }, area: { label: "Area", key: (p) => p.area },
    status: { label: "Status", key: (p) => p.status }, year: { label: "Auction year", key: (p) => p.auctionDate ? String(toDate(p.auctionDate).getFullYear()) : "Unknown" },
    tier: { label: "Cost tier", key: tierOf, order: TIERS.map((t) => t[2]) },
    priorLabel: { label: "Prior auctions", key: (p) => p.priorAuctions ? `In ${p.priorAuctions} earlier auction${p.priorAuctions > 1 ? "s" : ""}` : "First time at auction" },
    addrKind: { label: "Address type", key: (p) => !p.address ? "Not available" : p.addressExact ? "Site address" : /^Rural/.test(p.address) ? "Rural (distance from town)" : "Nearest street (approx.)" },
    warLabel: { label: "Bidding war", key: (p) => !p.sold ? "Not sold" : p.war ? "Bidding war" : "Sold at minimum" },
  };
  // Every grid column can be pivoted. Numbers are grouped into ranges; text groups by value.
  const band = (cuts, fmt, none) => { const labels = cuts.map((c, i) => i === 0 ? `Under ${fmt(c)}` : `${fmt(cuts[i - 1])} to ${fmt(c)}`).concat(`${fmt(cuts[cuts.length - 1])} and up`);
    return { key: (v) => v == null || v === "" || Number.isNaN(v) ? none : labels[cuts.filter((c) => v >= c).length], order: labels.concat(none) }; };
  const k$ = (v) => v >= 1e6 ? "$" + (v / 1e6) + "M" : v >= 1000 ? "$" + (v / 1000) + "K" : "$" + v;
  const B = {
    won: band([1500, 3000, 7500, 15000, 40000, 100000], k$, "Not sold"),
    value: band([10000, 50000, 150000, 300000, 600000], k$, "No Assessor value"),
    excess: band([5000, 25000, 100000], k$, "No excess"),
    unpaid: band([4, 5, 7, 10], (v) => v + " yrs", "Not recorded"),
    deal: band([20, 35, 50, 70, 85], (v) => String(v), "No score"),
  };
  const multKey = (p) => !p.multiple ? "Not sold" : p.multiple < 1.005 ? "At minimum (1.0x)" : p.multiple < 2 ? "1x to 2x" : p.multiple < 5 ? "2x to 5x" : p.multiple < 10 ? "5x to 10x" : "10x and up";
  const street = (p) => { const a = (p.address || "").replace(/^Near\s+/i, "").replace(/^Rural land.*$/i, "Rural land").split(",")[0].replace(/^[\d-]+\s+/, "").replace(/\s+(Ut|Unit|Apt|#)\s*\S+$/i, "").trim(); return a || "Not available"; };
  Object.assign(PIVOTS, {
    "col:apn": { label: "Parcel book (first 3 digits)", key: (p) => "Book " + p.apn.slice(0, 3) },
    "col:auction": { label: "Auction", key: (p) => fmtDate(p.auctionDate, { month: "short", day: undefined }) || "Unknown", get order() { return AUCTIONS.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((a) => fmtDate(a.date, { month: "short", day: undefined })); } },
    "col:status": { label: "Status", key: (p) => p.status },
    "col:prior": { label: "Prior auctions", key: PIVOTS.priorLabel.key },
    "col:deal": { label: "Deal score (range)", key: (p) => B.deal.key(p.dealScore), order: B.deal.order },
    "col:address": { label: "Street", key: street },
    "col:listed": { label: "Listed at auction", key: (p) => p.location || "Not listed" },
    "col:area": { label: "Area", key: (p) => p.area },
    "col:type": { label: "Type", key: (p) => p.type, order: TYPES },
    "col:owner": { label: "Former owner", key: (p) => p.owner || "Unknown" },
    "col:owed": { label: "Owed (cost tier)", key: tierOf, order: TIERS.map((t) => t[2]) },
    "col:won": { label: "Winning bid (range)", key: (p) => B.won.key(p.sold ? p.winningBid : null), order: B.won.order },
    "col:multiple": { label: "Multiple of amount owed", key: multKey, order: ["At minimum (1.0x)", "1x to 2x", "2x to 5x", "5x to 10x", "10x and up", "Not sold"] },
    "col:value": { label: "Assessor value (range)", key: (p) => B.value.key(p.taxable), order: B.value.order },
    "col:unpaid": { label: "Yrs unpaid (est.)", key: (p) => B.unpaid.key(p.defaultYrs), order: B.unpaid.order },
    "col:excess": { label: "Excess proceeds (range)", key: (p) => B.excess.key(p.excess || null), order: B.excess.order },
    "col:links": { label: "Address type", key: PIVOTS.addrKind.key },
  });
  const HINT = { apn: "book", deal: "range", address: "street", owed: "cost tier", won: "range", multiple: "range", value: "range", unpaid: "range", excess: "range", links: "address type" };
  function fillPivotSelect() {
    const cur = G.pivot;
    $("pivotBy").innerHTML = `<option value="">None (show parcels)</option><optgroup label="By column">` +
      G.order.map((k) => `<option value="col:${k}">${esc(GCOLS[k].label)}${HINT[k] ? " (by " + HINT[k] + ")" : ""}</option>`).join("") +
      `</optgroup><optgroup label="Other groupings"><option value="dealRating">Deal rating</option><option value="year">Auction year</option><option value="warLabel">Bidding war</option></optgroup>`;
    $("pivotBy").value = PIVOTS[cur] ? cur : "";
  }
  function setPivot(v) {
    G.pivot = v; const P = PIVOTS[v];
    G.pivotSort = P && P.order ? "name" : "n"; G.pivotDir = P && P.order ? 1 : -1;
    $("pivotBy").value = v; $("colPanel").hidden = true; saveG(); if (AUCTIONS.length) drawTable();
  }

  function gridRows() {
    const q = $("fSearch").value.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    let rows = selected().parcels.filter((p) => !q || [p.apn, p.owner, p.location, p.address, p.area, p.type, p.status, p.dealRating, p.legal].join(" ").toLowerCase().includes(q) || (qd.length >= 5 && p.apn.replace(/\D/g, "").includes(qd)));
    if (G.filter) rows = rows.filter((p) => PIVOTS[G.filter.by].key(p) === G.filter.value);
    return rows;
  }
  function visibleCols(rows) {
    return G.order.filter((k) => !G.hidden.includes(k) && !(GCOLS[k].cond && !rows.some((p) => GCOLS[k].val(p) != null)));
  }
  function drawTable() {
    const rows = gridRows();
    $("pivotFilter").hidden = !G.filter;
    if (G.filter) $("pivotFilter").innerHTML = `Showing <b>${esc(PIVOTS[G.filter.by].label)}: ${esc(G.filter.value)}</b> <button type="button" id="clearPivotFilter">Show all</button>`;
    if (G.filter) $("clearPivotFilter").onclick = () => { G.filter = null; drawTable(); };
    if (G.pivot) return drawPivot(rows);
    const cols = visibleCols(rows);
    const c = GCOLS[G.sort] ? G.sort : "deal";
    rows.sort((a, b) => { const x = GCOLS[c].val(a), y = GCOLS[c].val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * G.dir; });
    const shown = rows.slice(0, 1000);
    $("parcelTable").innerHTML = `<thead><tr>${cols.map((k) => `<th draggable="true" data-k="${k}" class="${GCOLS[k].num ? "num" : ""}"${G.sort === k ? ` aria-sort="${G.dir > 0 ? "ascending" : "descending"}"` : ""} title="Drag to move; click to sort">${GCOLS[k].label}</th>`).join("")}</tr></thead><tbody>` +
      shown.map((p, i) => `<tr data-i="${i}">${cols.map((k) => `<td class="${GCOLS[k].num ? "num" : ""}${GCOLS[k].wrap ? " wrap" : ""}">${GCOLS[k].html(p)}</td>`).join("")}</tr>`).join("") + "</tbody>";
    wireHeaders(cols);
    $("parcelTable").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("a")) return; showDetail(shown[+tr.dataset.i]); }));
    const hasUnpaid = cols.includes("unpaid");
    $("tableNote").textContent = `${rows.length} parcel${rows.length === 1 ? "" : "s"} in ${selected().label}${rows.length > 1000 ? " (first 1,000 shown; download for all)" : ""}. ${hasUnpaid ? '"Yrs unpaid (est.)" = time the county held the parcel in trust plus the 3 years of delinquency required first.' : '"Yrs unpaid" is hidden because the county did not record trust dates for these parcels.'}`;
    renderColPanel(rows);
  }
  function wireHeaders(cols) {
    let dragK = null;
    $("parcelTable").querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => { const k = th.dataset.k; if (GCOLS[k].nosort) return; G.dir = G.sort === k ? -G.dir : (GCOLS[k].num ? -1 : 1); G.sort = k; drawTable(); });
      th.addEventListener("dragstart", (e) => { dragK = th.dataset.k; e.dataTransfer.effectAllowed = "move"; th.classList.add("dragging"); });
      th.addEventListener("dragend", () => th.classList.remove("dragging"));
      th.addEventListener("dragover", (e) => { e.preventDefault(); th.classList.add("dropzone"); });
      th.addEventListener("dragleave", () => th.classList.remove("dropzone"));
      th.addEventListener("drop", (e) => { e.preventDefault(); const to = th.dataset.k; if (!dragK || dragK === to) return; const o = G.order.filter((k) => k !== dragK); o.splice(o.indexOf(to), 0, dragK); G.order = o; saveG(); drawTable(); });
    });
  }
  function renderColPanel(rows) {
    fillPivotSelect();
    $("colPanel").innerHTML = G.order.map((k, i) => {
      const unavailable = GCOLS[k].cond && !rows.some((p) => GCOLS[k].val(p) != null);
      return `<div class="colrow"><label><input type="checkbox" data-k="${k}" ${G.hidden.includes(k) ? "" : "checked"} ${unavailable ? "disabled" : ""}> ${GCOLS[k].label}${unavailable ? ' <span class="muted small">(no data)</span>' : ""}</label><span><button type="button" data-pivot="${k}" title="Summarize the grid by this column">Pivot</button><button type="button" data-up="${k}" ${i === 0 ? "disabled" : ""} aria-label="Move up">&#8593;</button><button type="button" data-down="${k}" ${i === G.order.length - 1 ? "disabled" : ""} aria-label="Move down">&#8595;</button></span></div>`;
    }).join("");
    $("colPanel").querySelectorAll("input").forEach((cb) => cb.addEventListener("change", () => { const k = cb.dataset.k; G.hidden = cb.checked ? G.hidden.filter((x) => x !== k) : G.hidden.concat(k); saveG(); drawTable(); }));
    $("colPanel").querySelectorAll("[data-pivot]").forEach((b) => b.addEventListener("click", () => setPivot("col:" + b.dataset.pivot)));
    $("colPanel").querySelectorAll("[data-up],[data-down]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.up || b.dataset.down, i = G.order.indexOf(k), j = i + (b.dataset.up ? -1 : 1); [G.order[i], G.order[j]] = [G.order[j], G.order[i]]; saveG(); drawTable(); }));
  }
  function drawPivot(rows) {
    const P = PIVOTS[G.pivot];
    const groups = {};
    rows.forEach((p) => (groups[P.key(p)] = groups[P.key(p)] || []).push(p));
    let names = Object.keys(groups);
    const stat = (g) => { const s = g.filter((p) => p.sold); return { n: g.length, sold: s.length, owed: avg(g.map((p) => p.minBid)), won: avg(s.map((p) => p.winningBid)), mult: med(s.map((p) => p.multiple)), deal: avg(g.map((p) => p.dealScore)), war: s.length ? s.filter((p) => p.war).length / s.length : null, excess: sum(g.map((p) => p.excess)), prior: g.filter((p) => p.priorAuctions).length } };
    const S = {}; names.forEach((n) => (S[n] = stat(groups[n])));
    const pc = [["name", P.label], ["n", "Parcels", 1], ["sold", "Sold", 1], ["owed", "Avg owed", 1], ["won", "Avg winning bid", 1], ["mult", "Median multiple", 1], ["deal", "Avg deal score", 1], ["war", "Bidding wars", 1], ["prior", "Seen at earlier auctions", 1], ["excess", "Total excess", 1]];
    const k = G.pivotSort;
    const oi = (o, v) => { const i = o.indexOf(v); return i < 0 ? 999 : i; };
    names.sort((a, b) => k === "name" ? (P.order ? oi(P.order, a) - oi(P.order, b) || a.localeCompare(b) : a.localeCompare(b, undefined, { numeric: true })) * (G.pivotDir > 0 ? 1 : -1) : ((S[a][k] ?? -1) - (S[b][k] ?? -1)) * G.pivotDir);
    const fmt = { n: (v) => v, sold: (v) => v, owed: money, won: money, mult: (v) => v ? v.toFixed(1) + "x" : "", deal: (v) => v != null ? Math.round(v) : "", war: (v) => v == null ? "" : pct(v), prior: (v) => v, excess: (v) => v ? money(v) : "" };
    const tot = stat(rows);
    $("parcelTable").innerHTML = `<thead><tr>${pc.map((c) => `<th data-k="${c[0]}" class="${c[2] ? "num" : ""}"${k === c[0] ? ` aria-sort="${G.pivotDir > 0 ? "ascending" : "descending"}"` : ""}>${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      names.map((n) => `<tr data-g="${esc(n)}" class="pivotrow"><td><b>${esc(n)}</b></td>${pc.slice(1).map((c) => `<td class="num">${fmt[c[0]](S[n][c[0]])}</td>`).join("")}</tr>`).join("") +
      `</tbody><tfoot><tr><td><b>Total</b></td>${pc.slice(1).map((c) => `<td class="num"><b>${fmt[c[0]](tot[c[0]])}</b></td>`).join("")}</tr></tfoot>`;
    $("parcelTable").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const kk = th.dataset.k; G.pivotDir = G.pivotSort === kk ? -G.pivotDir : (kk === "name" ? 1 : -1); G.pivotSort = kk; drawTable(); }));
    $("parcelTable").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => { G.filter = { by: G.pivot, value: tr.dataset.g }; G.pivot = ""; $("pivotBy").value = ""; drawTable(); $("parcels").scrollIntoView({ behavior: "smooth" }); }));
    $("tableNote").textContent = `${names.length} group${names.length === 1 ? "" : "s"} across ${rows.length} parcels in ${selected().label}. Click a group to see its parcels.`;
    renderColPanel(rows);
  }
  function csv() {
    const rows = gridRows();
    const cols = visibleCols(rows).filter((k) => k !== "links");
    const extra = [["lat", (p) => p.lat], ["lon", (p) => p.lon], ["county_map", openWeb], ["deal_rating", (p) => p.dealRating]];
    const csvVal = (k, p) => { const v = GCOLS[k].val(p); if (k === "auction") return (p.auctionDate || "").slice(0, 10); if (typeof v === "number" && !Number.isInteger(v)) return k === "unpaid" ? v.toFixed(1) : v.toFixed(2); return v; };
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [cols.map((k) => GCOLS[k].label).concat(extra.map((e) => e[0])).map(q).join(",")].concat(rows.map((p) => cols.map((k) => csvVal(k, p)).concat(extra.map((e) => e[1](p))).map(q).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "clark-county-tax-auction-parcels.csv"; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- global search (all auctions, all fields) ---------- */
  const FIELDS = {
    parcel: (p) => p.apn + " " + p.apn.replace(/\D/g, ""), apn: (p) => p.apn + " " + p.apn.replace(/\D/g, ""),
    owner: (p) => p.owner, address: (p) => p.location + " " + p.address, location: (p) => p.location + " " + p.address, area: (p) => p.area + " " + p.town, town: (p) => p.area + " " + p.town,
    type: (p) => p.type, landuse: (p) => p.landUse, date: (p) => fmtDate(p.auctionDate, { month: "long" }) + " " + (p.auctionDate || "").slice(0, 10),
    auction: (p) => fmtDate(p.auctionDate, { month: "long" }), district: (p) => p.taxDistrict, war: (p) => p.war ? "yes" : "no",
  };
  const NUMS = {
    year: (p) => p.auctionDate ? toDate(p.auctionDate).getFullYear() : null, owed: (p) => p.minBid, min: (p) => p.minBid, minbid: (p) => p.minBid,
    won: (p) => p.winningBid, bid: (p) => p.winningBid, winning: (p) => p.winningBid, multiple: (p) => p.multiple, excess: (p) => p.excess,
    acres: (p) => p.acres, built: (p) => p.yearBuilt, value: (p) => p.taxable, sqft: (p) => p.sqft, unpaid: (p) => p.defaultYrs, held: (p) => p.tenure,
  };
  function haystack(p) {
    if (!p._hay) p._hay = [p.apn, p.apn.replace(/\D/g, ""), p.owner, p.location, p.address, p.legal, p.area, p.town, p.type, p.landUse, p.taxDistrict ? "district " + p.taxDistrict : "",
      fmtDate(p.auctionDate, { month: "long" }), (p.auctionDate || "").slice(0, 10), p.deedRecorded, p.trustDate, p.group ? "group " + p.group : "",
      p.personalPropertyExcluded ? "personal property excluded" : "", p.war ? "bidding war" : "sold at minimum",
      p.minBid, Math.round(p.minBid || 0), p.winningBid, p.excess, p.yearBuilt].filter((x) => x != null && x !== "").join(" | ").toLowerCase();
    return p._hay;
  }
  function parseQuery(q) {
    const tokens = q.toLowerCase().match(/"[^"]+"|\S+/g) || [];
    return tokens.map((t) => {
      t = t.replace(/"/g, "");
      let m = t.match(/^([a-z]+)(>=|<=|>|<|=)([\d.,$k]+)$/);
      if (m && NUMS[m[1]]) { let v = m[3].replace(/[$,]/g, ""); v = /k$/.test(v) ? parseFloat(v) * 1000 : parseFloat(v); return { num: NUMS[m[1]], op: m[2], v }; }
      m = t.match(/^([a-z]+):(.+)$/);
      if (m && (FIELDS[m[1]] || NUMS[m[1]])) return FIELDS[m[1]] ? { field: FIELDS[m[1]], text: m[2] } : { num: NUMS[m[1]], op: "=", v: parseFloat(m[2]) };
      const digits = t.replace(/\D/g, "");
      return { text: t, digits: /^\d{3}-?\d{2}/.test(t) ? digits : null };
    });
  }
  function matches(p, terms) {
    return terms.every((c) => {
      if (c.num) { const x = c.num(p); if (x == null || isNaN(x)) return false; return c.op === ">" ? x > c.v : c.op === "<" ? x < c.v : c.op === ">=" ? x >= c.v : c.op === "<=" ? x <= c.v : Math.abs(x - c.v) < (c.v >= 1000 ? 1 : 0.05); }
      if (c.field) return String(c.field(p) || "").toLowerCase().includes(c.text);
      if (c.digits) return p.apn.replace(/\D/g, "").includes(c.digits);
      return haystack(p).includes(c.text);
    });
  }
  let resRows = [], resSort = "auctionDate", resDir = -1;
  const hl = (text, words) => { let h = esc(text); words.forEach((w) => { if (w.length > 1) h = h.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); }); return h; };
  function runSearch() {
    const q = $("gSearch").value.trim();
    if (!q) { $("results").hidden = true; return; }
    const terms = parseQuery(q), words = terms.filter((t) => t.text && !t.field).map((t) => t.text);
    resRows = AUCTIONS.flatMap((a) => a.parcels).filter((p) => matches(p, terms));
    resRows.sort((a, b) => { const x = a[resSort], y = b[resSort]; return (typeof x === "number" || typeof y === "number" ? (x || 0) - (y || 0) : String(x || "").localeCompare(String(y || ""))) * resDir; });
    const sold = resRows.filter((p) => p.sold);
    $("results").hidden = false;
    $("resTitle").textContent = resRows.length ? `${resRows.length.toLocaleString()} result${resRows.length === 1 ? "" : "s"} for "${q}"` : `No results for "${q}"`;
    const shown = resRows.slice(0, 300);
    const cols = [["apn", "Parcel"], ["auctionDate", "Auction"], ["owner", "Former owner"], ["location", "Address"], ["area", "Area"], ["type", "Type"], ["minBid", "Owed", 1], ["winningBid", "Won", 1], ["multiple", "Multiple", 1]];
    $("resTable").innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c[0]}" class="${c[2] ? "num" : ""}"${resSort === c[0] ? ` aria-sort="${resDir > 0 ? "ascending" : "descending"}"` : ""}>${c[1]}</th>`).join("")}</tr></thead><tbody>` +
      shown.map((p, i) => `<tr data-i="${i}"><td>${hl(p.apn, words.concat(terms.filter((t) => t.digits).map((t) => t.text)))}</td><td>${fmtDate(p.auctionDate, { month: "short" })}</td><td class="wrap">${hl(p.owner, words)}</td><td class="wrap">${hl(p.location, words)}</td><td>${hl(p.area, words)}</td><td>${hl(p.type, words)}</td><td class="num">${money(p.minBid)}</td><td class="num">${p.sold ? money(p.winningBid) : "Pending"}</td><td class="num">${p.multiple ? p.multiple.toFixed(1) + "x" : ""}</td></tr>`).join("") + "</tbody>";
    $("resTable").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; resDir = resSort === k ? -resDir : -1; resSort = k; runSearch(); }));
    $("resTable").querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => showDetail(shown[+tr.dataset.i])));
    $("resNote").innerHTML = resRows.length ? `Average winning bid for these results: <b>${money(avg(sold.map((p) => p.winningBid)))}</b> across ${sold.length} sold parcel${sold.length === 1 ? "" : "s"}. ${resRows.length > 300 ? "Showing the first 300; download for all. " : ""}Click any row for full details.` : "Check the spelling, or try fewer words.";
  }
  function showDetail(p) {
    const row = (l, v) => v == null || v === "" ? "" : `<div><span>${l}</span><span>${v}</span></div>`;
    const digits = p.apn.replace(/\D/g, "");
    $("detailBody").innerHTML = `<h2>${esc(p.apn)}</h2><div class="muted">${esc(p.address || p.location)}${p.address && !p.addressExact ? " (approximate)" : ""}</div>
      <div class="dgrid">
        ${row("Deal score", `${ratingPill(p)} <span class="muted small">value ${p.dealParts.value}/45, type ${p.dealParts.type}/20, location ${p.dealParts.location}/15, signals ${p.dealParts.signals}/10, competition ${p.dealParts.competition}/10</span>`)}
        ${row("Status", esc(p.status))}
        ${row("Prior auctions", p.priorAuctions ? p.priorAuctions + " (" + esc(p.priorDates.join(", ")) + ")" : "None")}
        ${row("Auction", fmtDate(p.auctionDate, { weekday: "short", month: "long" }))}
        ${row("Deed recorded", p.deedRecorded ? fmtDate(p.deedRecorded) : "")}
        ${row("Amount owed (minimum bid)", money(p.minBid))}
        ${row("Winning bid", p.sold ? money(p.winningBid) : "Pending")}
        ${row("Multiple of amount owed", p.multiple ? p.multiple.toFixed(2) + "x" : "")}
        ${row("Bidding war", p.sold ? (p.war ? "Yes" : "No, sold at minimum") : "")}
        ${row("Excess proceeds", p.excess ? money(p.excess) : "")}
        ${row("Address listed at auction", esc(p.location))}
        ${row("Legal description", esc(p.legal))}
        ${row("Coordinates", p.lat ? p.lat.toFixed(5) + ", " + p.lon.toFixed(5) : "")}
        ${row("Former owner", esc(p.owner))}
        ${row("Parcel type", esc(p.type))}
        ${row("Assessor land use", esc(p.landUse))}
        ${row("Lot size", p.acres ? p.acres + " acres" : "")}
        ${row("Year built", p.yearBuilt || "")}
        ${row("Living area", p.sqft ? p.sqft.toLocaleString() + " sq ft" : "")}
        ${row("Assessor taxable value (current)", p.taxable ? money(p.taxable) : "")}
        ${row("Tax district", esc(p.taxDistrict))}
        ${row("County took title in trust", p.trustDate ? fmtDate(p.trustDate) : "")}
        ${row("Estimated years unpaid", p.defaultYrs != null ? p.defaultYrs.toFixed(1) + " yrs" : "")}
        ${row("Personal property", p.personalPropertyExcluded ? "Not included in sale" : "")}
        ${row("Sold as group", esc(p.group || ""))}
      </div>
      <div class="dlinks">
        <a href="${openWeb(p)}" target="_blank" rel="noopener"><b>County OpenWeb map</b></a>
        <a href="https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=${digits}" target="_blank" rel="noopener">Assessor record</a>
        <a href="https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ParcelHistory.aspx?instance=pcl2&parcel=${digits}" target="_blank" rel="noopener">Ownership history</a>
        ${p.lat ? `<a href="https://www.google.com/maps?q=${p.lat},${p.lon}" target="_blank" rel="noopener">Google Maps</a>` : ""}
        <a href="https://treasurer.clarkcountynv.gov/auction" target="_blank" rel="noopener">County auction site</a>
      </div>`;
    $("detail").showModal();
  }
  function resultsCsv() {
    const head = ["auction_date", "parcel", "former_owner", "address", "area", "type", "land_use", "owed_min_bid", "winning_bid", "multiple", "excess_proceeds", "acres", "year_built", "taxable_value", "est_years_unpaid", "owner_held_years"];
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(resRows.map((p) => [(p.auctionDate || "").slice(0, 10), p.apn, p.owner, p.location, p.area, p.type, p.landUse, p.minBid, p.winningBid, p.multiple ? p.multiple.toFixed(2) : "", p.excess, p.acres, p.yearBuilt, p.taxable, p.defaultYrs != null ? p.defaultYrs.toFixed(1) : "", p.tenure != null ? p.tenure.toFixed(1) : ""].map(q).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "tax-auction-search-results.csv"; document.body.appendChild(a); a.click(); a.remove();
  }
  let searchTimer;
  $("gSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });
  $("gSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { runSearch(); $("results").scrollIntoView({ behavior: "smooth", block: "start" }); } });
  document.querySelectorAll(".examples button[data-q]").forEach((b) => b.addEventListener("click", () => { $("gSearch").value = b.dataset.q; runSearch(); }));
  $("searchHelpBtn").addEventListener("click", () => { $("searchHelp").hidden = !$("searchHelp").hidden; });
  $("resClear").addEventListener("click", () => { $("gSearch").value = ""; runSearch(); $("gSearch").focus(); });
  $("resCsv").addEventListener("click", resultsCsv);
  $("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });
  try { const q0 = new URLSearchParams(location.search).get("q"); if (q0) $("gSearch").value = q0; } catch (e) { /* ignore */ }

  /* ---------- load ---------- */
  async function load() {
    try {
      const [raw, info] = await Promise.all([
        fetch("auctions.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()),
        fetch("parcels.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
      ]);
      if (RAW && RAW.lastChecked === raw.lastChecked) return;
      RAW = raw; prep(raw, info);
      const sel = $("fAuction"), keep = sel.value;
      sel.innerHTML = `<option value="all">All auctions (${AUCTIONS.filter((a) => a.parcels.length).length})</option>` + AUCTIONS.slice().reverse().filter((a) => a.parcels.length).map((a) => `<option value="${a.id}">${fmtDate(a.date, { month: "long" })}${a.upcoming ? " (upcoming)" : ""}</option>`).join("");
      sel.value = keep && [...sel.options].some((o) => o.value === keep) ? keep : String(AUCTIONS.filter((a) => a.parcels.length).slice(-1)[0].id);
      $("freshness").innerHTML = `<span class="dotlive"></span>Checked <b>${fmtDate(raw.lastChecked)} ${toDate(raw.lastChecked).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })} PT</b> &middot; updates automatically`;
      const up = AUCTIONS.filter((a) => a.upcoming).pop();
      const last = AUCTIONS.filter((a) => a.parcels.some((p) => p.sold)).pop();
      $("next").innerHTML = up ? `<b>Next auction: ${fmtDate(up.date, { weekday: "long", month: "long" })}</b> at the Clark County Government Center. ${up.parcels.length ? up.parcels.length + " parcels listed." : "Parcel list not posted yet."}`
        : `<b>No upcoming auction posted yet.</b> The last one was ${fmtDate(last.date, { month: "long" })}; recent auctions have been held each May. This page updates as soon as the county posts a date.`;
      charts.forEach((c) => c.destroy()); charts = [];
      render();
      if ($("gSearch").value.trim()) runSearch();
    } catch (e) { $("freshness").textContent = "Could not load data. Please refresh."; console.error(e); }
  }
  $("fAuction").addEventListener("change", () => { G.filter = null; charts.forEach((c) => c.destroy()); charts = []; render(); });
  $("fSearch").addEventListener("input", drawTable);
  $("csvBtn").addEventListener("click", csv);
  $("pivotBy").addEventListener("change", () => setPivot($("pivotBy").value));
  $("colBtn").addEventListener("click", (e) => { e.stopPropagation(); $("colPanel").hidden = !$("colPanel").hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".colmenu")) $("colPanel").hidden = true; });
  $("resetCols").addEventListener("click", () => { G.order = DEFAULT_ORDER.slice(); G.hidden = DEFAULT_HIDDEN.slice(); G.pivot = ""; G.filter = null; $("pivotBy").value = ""; saveG(); drawTable(); });
  load();
  setInterval(load, 30 * 60 * 1000);
})();
