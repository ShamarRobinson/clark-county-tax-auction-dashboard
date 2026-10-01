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

  const TIERS = [[0, 2500, "Under $2.5K"], [2500, 10000, "$2.5K to $10K"], [10000, 50000, "$10K to $50K"], [50000, 150000, "$50K to $150K"], [150000, Infinity, "$150K and up"]];
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
    renderLookup();
    drawTable();
  }

  function renderKpis(S, sold) {
    const k = (label, value, note, hero) => `<div class="kpi${hero ? " hero" : ""}"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note || ""}</div></div>`;
    $("kpis").innerHTML = [
      k("Average winning bid", money(avg(sold.map((p) => p.winningBid))), "Median " + money(med(sold.map((p) => p.winningBid))), true),
      k("Parcels sold", sold.length.toLocaleString(), S.all ? `${S.auctions.length} auctions` : ""),
    ].join("");
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
      rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${money(r.avgMin)}</td><td class="num"><b>${money(r.avgWin)}</b></td><td class="num">${r.mult ? r.mult.toFixed(1) + "x" : ""}</td><td class="num">${pct(r.war)}</td></tr>`).join("") + "</tbody>";
  }

  function renderTiers(sold) {
    const rows = groupRows(sold, (p) => (TIERS.find((t) => p.minBid >= t[0] && p.minBid < t[1]) || TIERS[0])[2], TIERS.map((t) => t[2]));
    statTable("tTiers", rows, "Amount owed");
    chart("cTiers", { type: "bar", data: { labels: rows.map((r) => r.name), datasets: [bar("Average owed", rows.map((r) => r.avgMin), cssVar("--s1")), bar("Average winning bid", rows.map((r) => r.avgWin), cssVar("--s2"))] },
      options: Object.assign(barOpts(short), { plugins: Object.assign(barOpts(short).plugins, { legend: { display: true, labels: { boxWidth: 10, color: cssVar("--text-2") } } }) }) });
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
      rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td class="num"><b>${money(r.avgWin)}</b></td><td class="num">${r.mult ? r.mult.toFixed(1) + "x" : ""}</td><td class="num">${pct(r.war)}</td></tr>`).join("") + "</tbody>";
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
    pts.forEach((p) => {
      L.circleMarker([p.lat, p.lon], { radius: 4 + 12 * Math.sqrt(p.winningBid / maxW), color: cssVar("--surface"), weight: 1, fillColor: p.war ? cssVar("--s2") : cssVar("--s1"), fillOpacity: 0.85 })
        .bindPopup(`<b>${esc(p.apn)}</b><br>${esc(p.location)}<br>${esc(p.type)} &middot; ${esc(p.area)}<br>Owed ${money(p.minBid)}, won ${money(p.winningBid)}${p.war ? ` (${p.multiple.toFixed(1)}x)` : ""}<br>${fmtDate(p.auctionDate)}`)
        .addTo(layer);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.1));
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

  /* ---------- parcel table ---------- */
  let sortKey = "winningBid", dir = -1;
  const COLS = [
    ["apn", "Parcel", (p) => apnLink(p.apn)], ["auctionDate", "Auction", (p) => fmtDate(p.auctionDate, { month: "short", day: undefined })],
    ["type", "Type", (p) => esc(p.type)], ["area", "Area", (p) => esc(p.area)], ["location", "Address", (p) => esc(p.location), "wrap"],
    ["minBid", "Owed", (p) => money(p.minBid), "num"], ["winningBid", "Won", (p) => p.sold ? money(p.winningBid) : "Pending", "num"],
    ["multiple", "Multiple", (p) => p.multiple ? p.multiple.toFixed(1) + "x" : "", "num"], ["defaultYrs", "Yrs unpaid (est.)", (p) => p.defaultYrs != null ? p.defaultYrs.toFixed(1) : "", "num"], ["tenure", "Owner held", (p) => p.tenure != null ? Math.round(p.tenure) + " yrs" : "", "num"],
    ["excess", "Excess", (p) => p.excess ? money(p.excess) : "", "num"],
  ];
  function rowsNow() {
    const q = $("fSearch").value.trim().toLowerCase();
    return selected().parcels.filter((p) => !q || [p.apn, p.owner, p.location, p.area, p.type].join(" ").toLowerCase().includes(q))
      .sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === "number" || typeof y === "number" ? (x || 0) - (y || 0) : String(x || "").localeCompare(String(y || ""))) * dir; });
  }
  function drawTable() {
    const rows = rowsNow();
    $("parcelTable").innerHTML = `<thead><tr>${COLS.map((c) => `<th data-k="${c[0]}" class="${c[3] === "num" ? "num" : ""}"${sortKey === c[0] ? ` aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${c[1]}</th>`).join("")}</tr></thead><tbody>${rows.map((p) => `<tr>${COLS.map((c) => `<td class="${c[3] || ""}">${c[2](p)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    $("parcelTable").querySelectorAll("tbody tr").forEach((tr, i) => tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") showDetail(rows[i]); }));
    $("parcelTable").querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; dir = sortKey === k ? -dir : -1; sortKey = k; drawTable(); }));
    $("tableNote").textContent = `${rows.length} parcels shown. "Yrs unpaid (est.)" = time the county held the parcel in trust plus the 3 years of delinquency required first. "Owner held" = how long the former owner owned it.`;
  }
  function csv() {
    const head = ["auction_date", "parcel", "type", "land_use", "area", "address", "former_owner", "owed_min_bid", "winning_bid", "multiple", "est_years_unpaid", "county_trustee_date", "owner_held_years", "excess_proceeds", "lat", "lon"];
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(rowsNow().map((p) => [(p.auctionDate || "").slice(0, 10), p.apn, p.type, p.landUse, p.area, p.location, p.owner, p.minBid, p.winningBid, p.multiple ? p.multiple.toFixed(2) : "", p.defaultYrs != null ? p.defaultYrs.toFixed(1) : "", p.trustDate || "", p.tenure != null ? p.tenure.toFixed(1) : "", p.excess, p.lat, p.lon].map(q).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "clark-county-tax-auction-parcels.csv"; document.body.appendChild(a); a.click(); a.remove();
  }



  /* ---------- parcel location lookup ---------- */
  const openWeb = (p) => "https://maps.clarkcountynv.gov/openweb/?@" + p.apn.replace(/\D/g, "");
  const gmaps = (p) => p.lat ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.address || p.location) + " Clark County NV")}`;
  function renderLookup() {
    const q = $("lSearch").value.trim().toLowerCase();
    const base = q ? AUCTIONS.flatMap((a) => a.parcels) : selected().parcels;
    const rows = base.filter((p) => !q || [p.apn, p.apn.replace(/\D/g, ""), p.location, p.address, p.area, p.owner, p.legal].join(" ").toLowerCase().includes(q.replace(/^(\d{3})-?(\d{2})-?(\d{3})-?(\d{3})$/, "$1-$2-$3-$4")))
      .sort((a, b) => (b.auctionDate || "").localeCompare(a.auctionDate || "") || a.apn.localeCompare(b.apn)).slice(0, 400);
    $("tLookup").innerHTML = `<thead><tr><th>Parcel</th><th>Auction</th><th>Listed at auction</th><th>Correct address or location</th><th>Area</th><th>Open in</th></tr></thead><tbody>` +
      rows.map((p) => `<tr><td><a href="${openWeb(p)}" target="_blank" rel="noopener">${esc(p.apn)}</a></td><td>${fmtDate(p.auctionDate, { month: "short", day: undefined })}</td>
        <td class="wrap muted">${esc(p.location || "")}</td>
        <td class="wrap">${esc(p.address || "Not available")} ${p.address ? (p.addressExact ? '<span class="pill ok">Site address</span>' : '<span class="pill">Approximate</span>') : ""}</td>
        <td>${esc(p.area)}</td>
        <td class="links"><a href="${openWeb(p)}" target="_blank" rel="noopener">County map</a> &middot; <a href="https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=${p.apn.replace(/\D/g, "")}" target="_blank" rel="noopener">Assessor</a> &middot; <a href="${gmaps(p)}" target="_blank" rel="noopener">Google Maps</a></td></tr>`).join("") + "</tbody>";
    const exact = rows.filter((p) => p.addressExact).length;
    $("lNote").textContent = rows.length ? `${rows.length} parcel${rows.length === 1 ? "" : "s"} ${q ? "matching your search across all auctions" : "in " + selected().label}. ${exact} have a site address on file with the Assessor; the rest show the nearest street from the county's address locator.` : "No parcels match. Try a parcel number like 138-10-510-001 or part of a street name.";
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
        ${row("Estimated years unpaid", p.defaultYrs != null ? p.defaultYrs.toFixed(1) + " yrs" : "3+ yrs")}
        ${row("Former owner held it", p.tenure != null ? p.tenure.toFixed(1) + " yrs" : "")}
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
  $("fAuction").addEventListener("change", () => { charts.forEach((c) => c.destroy()); charts = []; render(); });
  $("fSearch").addEventListener("input", drawTable);
  $("csvBtn").addEventListener("click", csv);
  $("lSearch").addEventListener("input", () => { if (AUCTIONS.length) renderLookup(); });
  load();
  setInterval(load, 30 * 60 * 1000);
})();
