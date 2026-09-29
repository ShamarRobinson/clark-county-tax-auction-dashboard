/* Clark County Tax Auction Tracker
 * Reads auctions.json (refreshed by a GitHub Action) and renders everything client side.
 * All insights are computed from the data, so they change when the county's data changes. */
(function () {
  "use strict";
  const DATA_URL = "auctions.json";
  const REFRESH_MS = 30 * 60 * 1000; // re-check for a new data file every 30 minutes
  const REPO_URL = "https://github.com/ShamarRobinson/clark-county-tax-auction-dashboard";
  const DAY = 86400000;

  const $ = (id) => document.getElementById(id);
  const money = (n, dec) => n == null || isNaN(n) ? "n/a" :
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dec ? 2 : 0, minimumFractionDigits: dec ? 2 : 0 });
  const moneyShort = (n) => {
    if (n == null || isNaN(n)) return "n/a";
    const a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3).toLocaleString() + "K";
    return "$" + Math.round(n);
  };
  const pct = (x) => (x * 100).toFixed(0) + "%";
  const toDate = (d) => d instanceof Date ? d : new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00-07:00" : d);
  const fmtDate = (d, opts) => d ? toDate(d).toLocaleDateString("en-US", Object.assign({ month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }, opts || {})) : "n/a";
  const fmtTime = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const median = (arr) => { const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const sum = (arr) => arr.reduce((s, x) => s + (x || 0), 0);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isVacant = (loc) => !/^\s*\d*[1-9]\d*\s+\S/.test(loc || "");
  const apnLink = (apn) => `<a href="https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=${apn.replace(/\D/g, "")}" target="_blank" rel="noopener">${esc(apn)}</a>`;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  let DATA = null, charts = [], lastStamp = null;

  /* ---------- data prep ---------- */
  function prep(raw) {
    const auctions = raw.auctions.map((a) => {
      const starts = a.events.map((e) => e.start).filter(Boolean).sort();
      const date = starts[0] || null;
      const parcels = a.parcels.map((p) => Object.assign({}, p, {
        vacant: isVacant(p.location),
        sold: p.winningBid != null && p.winningBid > 0,
        multiple: p.winningBid && p.minBid ? p.winningBid / p.minBid : null,
      }));
      const sold = parcels.filter((p) => p.sold);
      const deed = sold.map((p) => p.deedRecorded).filter(Boolean).sort()[0] || null;
      const excessTotal = sum(sold.map((p) => p.excess));
      const upcoming = a.events.some((e) => e.start && new Date(e.start).getTime() > Date.now() - DAY / 2) ||
        a.events.some((e) => e.status && !/prior/i.test(e.status));
      return {
        id: a.id, isCurrent: a.isCurrent, date, events: a.events, parcels, sold, deed, upcoming,
        label: date ? fmtDate(date, { month: "short", day: undefined }) : "Auction " + a.id,
        year: date ? new Date(date).getFullYear() : null,
        minTotal: sum(sold.map((p) => p.minBid)),
        winTotal: sum(sold.map((p) => p.winningBid)),
        excessTotal, excessKnown: excessTotal > 0,
        medMultiple: median(sold.map((p) => p.multiple)),
        atMinShare: sold.length ? sold.filter((p) => p.multiple != null && p.multiple <= 1.0001).length / sold.length : null,
      };
    }).sort((x, y) => (x.date || "").localeCompare(y.date || ""));
    return { raw, auctions, withResults: auctions.filter((a) => a.sold.length) };
  }

  /* ---------- render ---------- */
  function render() {
    const { raw, auctions, withResults } = DATA;
    const latest = withResults[withResults.length - 1];
    renderFreshness(raw);
    renderBanner(auctions, withResults);
    renderKpis(latest, withResults);
    renderInsights(latest, withResults, auctions);
    renderClaims(withResults);
    renderCharts(latest, withResults);
    renderLatestDetail(latest);
    renderSchedule(auctions);
    setupTable(auctions, latest);
    $("repoLink").href = REPO_URL;
  }

  function renderFreshness(raw) {
    $("freshness").innerHTML =
      `<span><span class="dot"></span>Checked <b>${fmtDate(raw.lastChecked)} ${fmtTime(raw.lastChecked)} PT</b></span>` +
      `<span>County data last changed <b>${fmtDate(raw.lastChanged)}</b></span>` +
      `<span>${DATA.auctions.length} auctions on record since ${DATA.auctions[0].year}</span>`;
  }

  function renderBanner(auctions, withResults) {
    const up = auctions.filter((a) => a.upcoming && !a.sold.length);
    const el = $("banner");
    if (up.length) {
      const a = up[up.length - 1];
      const evs = a.events.slice().sort((x, y) => (x.start || "").localeCompare(y.start || ""));
      const first = evs[0];
      const days = Math.ceil((new Date(first.start) - Date.now()) / DAY);
      const listCount = a.parcels.length;
      el.innerHTML = `<h3>Upcoming auction posted</h3>
        <div class="when">${fmtDate(first.start, { weekday: "long", month: "long" })}${days >= 0 ? ` &middot; ${days} day${days === 1 ? "" : "s"} away` : ""}</div>
        ${evs.map((e) => `<p>Session ${esc(e.no)}: ${fmtTime(e.start)} PT, ${esc(e.type || "")} ${e.address ? "at " + esc(e.address) : ""}</p>`).join("")}
        <p>${listCount ? `<b>${listCount}</b> parcels currently listed, with ${moneyShort(sum(a.parcels.map((p) => p.minBid)))} in combined minimum bids. See the table below (choose this auction).` : "The parcel list has not been published yet."}
        Parcels can drop off before the sale if owners pay what they owe. Registration and bidder rules are on the <a href="https://treasurer.clarkcountynv.gov/auction" target="_blank" rel="noopener">Treasurer's auction site</a>.</p>`;
      return;
    }
    // No upcoming auction: estimate from history
    const recent = withResults.slice(-5).map((a) => new Date(a.date));
    const monthCounts = {};
    recent.forEach((d) => { const m = d.toLocaleString("en-US", { month: "long", timeZone: "America/Los_Angeles" }); monthCounts[m] = (monthCounts[m] || 0) + 1; });
    const [topMonth, n] = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0] || ["May", 0];
    const lastDate = new Date(withResults[withResults.length - 1].date);
    let nextYear = new Date().getFullYear();
    const monthIdx = new Date(`${topMonth} 1, 2000`).getMonth();
    if (new Date() > new Date(nextYear, monthIdx + 1, 0)) nextYear += 1;
    el.innerHTML = `<h3>No upcoming auction posted yet</h3>
      <p>The most recent sale was ${fmtDate(lastDate, { weekday: "long", month: "long" })}. ${n} of the last ${recent.length} auctions were held in <b>${topMonth}</b>, so the next one is most likely <b>${topMonth} ${nextYear}</b>.
      The county holds auctions only if necessary. This page updates automatically as soon as a date is posted.</p>`;
  }

  function kpi(label, value, note) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;
  }

  function renderKpis(a, all) {
    const prev = all[all.length - 2];
    const chg = (cur, old) => old ? `${cur >= old ? "+" : ""}${pct((cur - old) / old)} vs. ${prev.year}` : "";
    $("latestTitle").textContent = `Latest auction: ${fmtDate(a.date, { weekday: "long", month: "long" })}`;
    $("latestSub").textContent = a.deed ? `Deeds recorded ${fmtDate(a.deed)}.` : "";
    $("kpis").innerHTML = [
      kpi("Parcels sold", a.sold.length, prev ? chg(a.sold.length, prev.sold.length) : ""),
      kpi("Total winning bids", moneyShort(a.winTotal), prev ? chg(a.winTotal, prev.winTotal) : ""),
      kpi("Total minimum bids", moneyShort(a.minTotal), "Taxes, penalties and costs owed"),
      kpi("Bid up over minimums", moneyShort(a.winTotal - a.minTotal), `${(a.winTotal / a.minTotal).toFixed(2)}x the minimums overall`),
      kpi("Excess proceeds", a.excessKnown ? moneyShort(a.excessTotal) : "n/a", "Held for former owners"),
      kpi("Median bid multiple", a.medMultiple ? a.medMultiple.toFixed(2) + "x" : "n/a", `${pct(a.atMinShare)} sold at the minimum`),
    ].join("");
  }

  function renderInsights(a, all, auctionsAll) {
    const out = [];
    const sorted = all.slice().sort((x, y) => y.sold.length - x.sold.length);
    const rank = sorted.indexOf(a) + 1;
    const since = all.filter((x) => x.sold.length > a.sold.length && x.date < a.date).pop();
    out.push(`<b>${a.sold.length} parcels sold</b> in ${a.year}, ${rank === 1 ? "the most of any auction on record" : since ? `the most since ${since.year}` : `ranking #${rank} of ${all.length} auctions`}. The ${all.length}-auction average is ${Math.round(sum(all.map((x) => x.sold.length)) / all.length)}.`);

    const wars = a.sold.filter((p) => p.multiple > 1.0001);
    out.push(`<b>${wars.length} of ${a.sold.length}</b> parcels (${pct(wars.length / a.sold.length)}) drew competing bids above the minimum. The other ${a.sold.length - wars.length} went at the opening price${a.sold.length - wars.length ? `, including ${moneyShort(sum(a.sold.filter((p) => p.multiple <= 1.0001).map((p) => p.minBid)))} of properties where bidders paid only what was owed` : ""}.`);

    const top = a.sold.slice().sort((x, y) => y.multiple - x.multiple)[0];
    if (top) out.push(`<b>Biggest bidding war:</b> ${esc(top.location && !top.vacant ? top.location : "parcel " + top.apn)} opened at ${money(top.minBid)} and sold for ${money(top.winningBid)}, <b>${top.multiple.toFixed(0)}x</b> the minimum.`);

    const addr = a.sold.filter((p) => !p.vacant), vac = a.sold.filter((p) => p.vacant);
    if (addr.length && vac.length) out.push(`<b>Addressed properties</b> (${addr.length}) had a median winning bid of ${money(median(addr.map((p) => p.winningBid)))} vs. ${money(median(vac.map((p) => p.winningBid)))} for the ${vac.length} parcels with no street address (mostly vacant land), and they made up ${pct(sum(addr.map((p) => p.winningBid)) / a.winTotal)} of total dollars.`);

    const hist = all.filter((x) => x.medMultiple);
    const avgMult = median(hist.map((x) => x.medMultiple));
    if (a.medMultiple && avgMult) out.push(`<b>Competition ${a.medMultiple > avgMult ? "was hotter" : "was cooler"} than usual:</b> the median parcel sold for ${a.medMultiple.toFixed(2)}x its minimum vs. a typical ${avgMult.toFixed(2)}x across all auctions since ${all[0].year}.`);

    // Owner concentration
    const byOwner = {};
    a.sold.forEach((p) => { const k = (p.owner || "").split(",")[0].trim(); if (k) (byOwner[k] = byOwner[k] || []).push(p); });
    const fam = {};
    Object.entries(byOwner).forEach(([k, v]) => { const key = k.split(" ")[0]; (fam[key] = fam[key] || []).push(...v); });
    const bigOwner = Object.entries(fam).sort((x, y) => y[1].length - x[1].length)[0];
    if (bigOwner && bigOwner[1].length >= 3) out.push(`<b>Concentration:</b> ${bigOwner[1].length} parcels (${pct(bigOwner[1].length / a.sold.length)}) came from owners named ${esc(bigOwner[0])}, likely a single family holding of small vacant lots.`);

    // Excess
    if (a.excessKnown) {
      const bigEx = a.sold.slice().sort((x, y) => (y.excess || 0) - (x.excess || 0));
      const top3 = sum(bigEx.slice(0, 3).map((p) => p.excess));
      out.push(`<b>${moneyShort(a.excessTotal)} in excess proceeds</b> is being held for former owners. The top 3 parcels account for ${pct(top3 / a.excessTotal)} of it, and ${a.sold.filter((p) => (p.excess || 0) > 0).length} former owners have something to claim.`);
    }

    // Long-run totals
    const allSold = sum(all.map((x) => x.sold.length));
    const allWin = sum(all.map((x) => x.winTotal));
    out.push(`<b>Since ${all[0].year}:</b> ${allSold.toLocaleString()} parcels have sold for ${moneyShort(allWin)} in total across ${all.length} auctions${auctionsAll.length > all.length ? ` (${auctionsAll.length - all.length} scheduled auctions show no published results, e.g. ${auctionsAll.filter((x) => !x.sold.length && !x.upcoming).map((x) => x.year).join(", ")})` : ""}.`);

    // Big-ticket minimums
    const bigMin = a.sold.filter((p) => p.minBid >= 100000);
    if (bigMin.length) out.push(`<b>${bigMin.length} high-balance parcel${bigMin.length > 1 ? "s" : ""}</b> carried minimum bids over $100K (${moneyShort(sum(bigMin.map((p) => p.minBid)))} combined). ${bigMin.filter((p) => p.multiple <= 1.0001).length} of them sold at the minimum, so large delinquent balances tend to deter competing bids.`);

    $("insights").innerHTML = out.map((s) => `<li>${s}</li>`).join("");
  }

  function renderClaims(all) {
    const now = Date.now();
    const cards = all.filter((a) => a.deed && a.excessKnown).slice(-3).reverse().map((a) => {
      const deadline = new Date(new Date(a.deed + "T12:00:00-07:00").getTime());
      deadline.setFullYear(deadline.getFullYear() + 1);
      const days = Math.ceil((deadline - now) / DAY);
      const cls = days < 0 ? "closed" : days <= 60 ? "soon" : "open";
      const label = days < 0 ? "Claim window closed" : `Open &middot; ${days} days left`;
      const n = a.sold.filter((p) => (p.excess || 0) > 0).length;
      return `<div class="claim"><div class="muted small">${fmtDate(a.date, { month: "long" })} auction</div>
        <div class="amt">${money(a.excessTotal)}</div>
        <div class="small muted">${n} parcels with excess proceeds</div>
        <div class="status ${cls}">${label}</div>
        <div class="small muted">Deadline: ${fmtDate(deadline, { month: "long" })} (1 year after deed recorded ${fmtDate(a.deed)})</div></div>`;
    });
    $("claims").innerHTML = cards.join("") || `<p class="muted">No excess proceeds data available.</p>`;
  }

  /* ---------- charts ---------- */
  function baseOpts(fmtY, extra) {
    const text = cssVar("--text-2"), grid = cssVar("--grid");
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtY(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true, font: { size: 11 } }, border: { color: grid } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, font: { size: 11 }, callback: (v) => fmtY(v) } },
      },
    }, extra || {});
  }

  function renderCharts(latest, all) {
    charts.forEach((c) => c.destroy()); charts = [];
    if (typeof Chart === "undefined") return;
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    const labels = all.map((a) => a.label);
    const s1 = cssVar("--s1"), s2 = cssVar("--s2"), s3 = cssVar("--s3"), surf = cssVar("--surface");
    const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 28, borderWidth: 0 });

    charts.push(new Chart($("cCount"), { type: "bar", data: { labels, datasets: [bar("Parcels sold", all.map((a) => a.sold.length), s1)] }, options: baseOpts((v) => Math.round(v)) }));
    charts.push(new Chart($("cDollars"), { type: "bar", data: { labels, datasets: [bar("Minimum bids", all.map((a) => a.minTotal), s1), bar("Winning bids", all.map((a) => a.winTotal), s2)] }, options: baseOpts(moneyShort, { datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } }) }));
    const line = (label, data, color, fmt) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: surf, pointBorderWidth: 2, tension: 0.25 });
    charts.push(new Chart($("cMultiple"), { type: "line", data: { labels, datasets: [line("Median multiple", all.map((a) => a.medMultiple), s1)] }, options: baseOpts((v) => (+v).toFixed(1) + "x") }));
    const o4 = baseOpts((v) => Math.round(v * 100) + "%"); o4.scales.y.max = 1;
    charts.push(new Chart($("cAtMin"), { type: "bar", data: { labels, datasets: [bar("Sold at minimum", all.map((a) => a.atMinShare), s3)] }, options: o4 }));

    const bands = [[0, 2500, "< $2.5K"], [2500, 10000, "$2.5K-10K"], [10000, 50000, "$10K-50K"], [50000, 150000, "$50K-150K"], [150000, Infinity, "$150K+"]];
    charts.push(new Chart($("cBands"), { type: "bar", data: { labels: bands.map((b) => b[2]), datasets: [bar("Parcels", bands.map((b) => latest.sold.filter((p) => p.winningBid >= b[0] && p.winningBid < b[1]).length), s1)] }, options: baseOpts((v) => Math.round(v)) }));
  }

  function renderLatestDetail(a) {
    $("mixTitle").textContent = `Inside the ${fmtDate(a.date, { month: "long", day: undefined })} auction`;
    const col = (title, arr) => `<div class="col"><div class="muted small">${title}</div><div class="big">${arr.length}</div>
      <div class="row"><span>Median winning bid</span><span>${money(median(arr.map((p) => p.winningBid)))}</span></div>
      <div class="row"><span>Median minimum bid</span><span>${money(median(arr.map((p) => p.minBid)))}</span></div>
      <div class="row"><span>Median multiple</span><span>${arr.length ? median(arr.map((p) => p.multiple)).toFixed(2) + "x" : "n/a"}</span></div>
      <div class="row"><span>Total winning bids</span><span>${moneyShort(sum(arr.map((p) => p.winningBid)))}</span></div>
      <div class="row"><span>Sold at minimum</span><span>${arr.length ? pct(arr.filter((p) => p.multiple <= 1.0001).length / arr.length) : "n/a"}</span></div></div>`;
    $("split").innerHTML = col("Has a street address", a.sold.filter((p) => !p.vacant)) + col("No street address (usually vacant land)", a.sold.filter((p) => p.vacant));
    const mini = (rows, cols) => `<div class="tablewrap"><table class="data mini"><thead><tr>${cols.map((c) => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const loc = (p) => p.vacant ? `<span class="pill">No address</span>` : esc(p.location);
    $("topPremium").innerHTML = mini(a.sold.slice().sort((x, y) => y.multiple - x.multiple).slice(0, 6), [["Parcel", (p) => apnLink(p.apn)], ["Location", loc], ["Min", (p) => money(p.minBid), "num"], ["Won", (p) => money(p.winningBid), "num"], ["x", (p) => p.multiple.toFixed(1) + "x", "num"]]);
    $("topExcess").innerHTML = a.excessKnown ? mini(a.sold.slice().sort((x, y) => (y.excess || 0) - (x.excess || 0)).slice(0, 6), [["Parcel", (p) => apnLink(p.apn)], ["Location", loc], ["Won", (p) => money(p.winningBid), "num"], ["Excess", (p) => money(p.excess), "num"]]) : `<p class="muted">Not reported for this auction.</p>`;
  }

  function renderSchedule(auctions) {
    const rows = auctions.slice().reverse().flatMap((a) => a.events.slice().sort((x, y) => (x.start || "").localeCompare(y.start || "")).map((e, i) => `<tr>
      <td>${i === 0 ? `<b>${fmtDate(a.date, { month: "long" })}</b>` : ""}</td>
      <td>${esc(e.no)}</td><td>${fmtDate(e.start, { weekday: "short" })}</td><td>${fmtTime(e.start)}</td>
      <td>${esc(e.type || "")}</td>
      <td class="wrap">${esc(e.address || "")}</td>
      <td class="num">${i === 0 ? (a.sold.length || (a.upcoming ? `${a.parcels.length} listed` : "No results")) : ""}</td></tr>`));
    const shown = scheduleExpanded ? rows : rows.slice(0, rowsForLatest(auctions, 5));
    $("scheduleToggle").textContent = scheduleExpanded ? "Show fewer" : `Show all ${auctions.length} auctions`;
    $("scheduleTable").innerHTML = `<thead><tr><th>Auction</th><th>Session</th><th>Date</th><th>Start</th><th>Type</th><th>Location</th><th class="num">Parcels sold</th></tr></thead><tbody>${shown.join("")}</tbody>`;
  }

  let scheduleExpanded = false;
  function rowsForLatest(auctions, n) { return auctions.slice().reverse().slice(0, n).reduce((t, a) => t + a.events.length, 0); }
  document.addEventListener("DOMContentLoaded", () => {});
  $("scheduleToggle").addEventListener("click", () => { scheduleExpanded = !scheduleExpanded; if (DATA) renderSchedule(DATA.auctions); });

  /* ---------- parcel table ---------- */
  let tableState = { auction: null, sortKey: "winningBid", dir: -1 };
  const COLS = [
    ["apn", "Parcel", (p) => apnLink(p.apn)],
    ["owner", "Former owner", (p) => esc(p.owner), "wrap"],
    ["location", "Location", (p) => p.vacant ? `<span class="pill">No address</span>` : esc(p.location)],
    ["minBid", "Minimum bid", (p) => money(p.minBid, true), "num"],
    ["winningBid", "Winning bid", (p) => p.sold ? money(p.winningBid, true) : "Pending", "num"],
    ["multiple", "Multiple", (p) => p.multiple ? p.multiple.toFixed(2) + "x" : "", "num"],
    ["excess", "Excess proceeds", (p) => p.excess ? money(p.excess, true) : "", "num"],
    ["flags", "Notes", (p) => [p.personalPropertyExcluded ? "Personal property excluded" : "", p.group ? "Sold as group " + esc(p.group) : ""].filter(Boolean).join("; "), "wrap"],
  ];

  function setupTable(auctions, latest) {
    const sel = $("fAuction");
    const prevVal = sel.value;
    sel.innerHTML = auctions.slice().reverse().filter((a) => a.parcels.length).map((a) => `<option value="${a.id}">${fmtDate(a.date, { month: "long" })} (${a.parcels.length})</option>`).join("");
    sel.value = prevVal && [...sel.options].some((o) => o.value === prevVal) ? prevVal : String((auctions.filter((a) => a.upcoming && a.parcels.length).pop() || latest).id);
    if (!setupTable.bound) {
      ["fAuction", "fSearch", "fType"].forEach((id) => $(id).addEventListener("input", drawTable));
      $("csvBtn").addEventListener("click", downloadCsv);
      setupTable.bound = true;
    }
    drawTable();
  }

  function currentRows() {
    const a = DATA.auctions.find((x) => String(x.id) === $("fAuction").value);
    if (!a) return { a: null, rows: [] };
    const q = $("fSearch").value.trim().toLowerCase();
    const t = $("fType").value;
    let rows = a.parcels.filter((p) => (!q || (p.apn + " " + p.owner + " " + p.location).toLowerCase().includes(q)) && (t === "all" || (t === "vacant" ? p.vacant : !p.vacant)));
    const k = tableState.sortKey, d = tableState.dir;
    rows = rows.slice().sort((x, y) => { const vx = x[k], vy = y[k]; if (typeof vx === "number" || typeof vy === "number") return ((vx || 0) - (vy || 0)) * d; return String(vx || "").localeCompare(String(vy || "")) * d; });
    return { a, rows };
  }

  function drawTable() {
    const { a, rows } = currentRows();
    const tbl = $("parcelTable");
    tbl.innerHTML = `<thead><tr>${COLS.map((c) => `<th data-k="${c[0]}" class="${c[3] === "num" ? "num" : ""}" ${tableState.sortKey === c[0] ? `aria-sort="${tableState.dir > 0 ? "ascending" : "descending"}"` : ""}>${c[1]}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((p) => `<tr>${COLS.map((c) => `<td class="${c[3] || ""}">${c[2](p)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    tbl.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k; if (k === "flags") return;
      tableState.dir = tableState.sortKey === k ? -tableState.dir : (k === "apn" || k === "owner" || k === "location" ? 1 : -1);
      tableState.sortKey = k; drawTable();
    }));
    if (a) $("tableNote").textContent = `${rows.length} of ${a.parcels.length} parcels shown. Click a column header to sort.`;
  }

  function downloadCsv() {
    const { a, rows } = currentRows();
    const head = ["auction_date", "parcel", "former_owner", "location", "min_bid", "winning_bid", "multiple", "excess_proceeds", "deed_recorded", "personal_property_excluded", "group"];
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(rows.map((p) => [a.date ? a.date.slice(0, 10) : "", p.apn, p.owner, p.location, p.minBid, p.winningBid, p.multiple ? p.multiple.toFixed(3) : "", p.excess, p.deedRecorded, p.personalPropertyExcluded, p.group || ""].map(q).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `clark-county-tax-auction-${a.date ? a.date.slice(0, 10) : a.id}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- load + auto refresh ---------- */
  async function load() {
    try {
      const res = await fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const raw = await res.json();
      const stamp = raw.lastChecked + "|" + raw.lastChanged;
      if (stamp === lastStamp) return;
      lastStamp = stamp;
      DATA = prep(raw);
      render();
    } catch (e) {
      if (!DATA) $("freshness").textContent = "Could not load data. Please refresh the page.";
      console.error(e);
    }
  }
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (DATA) renderCharts(DATA.withResults[DATA.withResults.length - 1], DATA.withResults); });
})();
