/* StudyIn AI — analytics dashboard */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";

const SERIES = [
  { key: "success", label: "Succeeded", color: "var(--series-ok)", cls: "key--ok" },
  { key: "failed", label: "Failed", color: "var(--series-fail)", cls: "key--fail" },
  { key: "cancelled", label: "Cancelled", color: "var(--series-cancel)", cls: "key--cancel" },
];
const ERROR_LABELS = {
  overloaded: "AI service overloaded",
  quota_exceeded: "API credits exhausted",
  api_error: "AI service error",
  response_failed: "AI response failed",
  content_filter: "Blocked by content filter",
  stream_error: "Stream error",
  rate_limited: "API rate limit",
  timeout: "Timed out",
  connection: "Connection error",
  server_error: "API server error",
  auth: "API key / permissions",
  bad_request: "Bad request",
  refusal: "Declined by safety check",
  empty_answer: "Empty answer",
  visitor_rate_limit: "Visitor hit rate limit",
  client_setup: "API key missing / client setup",
  internal: "App error",
  unknown: "Unknown",
};

const state = {
  days: "30",
  school: "",
  schoolName: "",
  flagged: false,
  demo: false,
  data: null,
  key: (() => { try { return sessionStorage.getItem("studyin.adminKey") || ""; } catch { return ""; } })(),
};

/* ---------------- formatting ---------------- */
const fmtInt = (n) => (n == null ? "–" : n >= 10000 ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : n.toLocaleString("en"));
const fmtPct = (r, d = 1) => (r == null ? "–" : `${(r * 100).toFixed(d)}%`);
const fmtSecs = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)}s`);
const fmtUsd = (n) => (n == null ? "–" : n >= 1000 ? `$${fmtInt(Math.round(n))}` : `$${n.toFixed(2)}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateLabel = (iso, opts = { month: "short", day: "numeric" }) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

function niceScale(max, ticks = 4) {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && (s >= 1 || Number.isInteger(s)));
  const s = Math.max(1, step);
  return { max: Math.ceil(max / s) * s, step: s };
}

function svgEl(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}

// Bar with a 4px rounded data-end and a square base.
function barPath(x, y, w, h, { horizontal = false, r = 4 } = {}) {
  if (horizontal) {
    const rr = Math.min(r, w / 2, h / 2);
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  }
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/* ---------------- tooltip ---------------- */
const tip = $("#tooltip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth;
  const left = Math.min(innerWidth - w / 2 - 8, Math.max(w / 2 + 8, x));
  const top = Math.max(tip.offsetHeight + 22, y);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => (tip.hidden = true);
const tipRow = (label, value, color) =>
  `<div class="row"><span>${color ? `<i class="key" style="background:${color}"></i>` : ""}${esc(label)}</span><b>${esc(value)}</b></div>`;

/* ---------------- charts ---------------- */
function emptyState(host, msg = "No data for this period") {
  host.innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

function stackedColumns(host, days) {
  const total = days.reduce((a, d) => a + d.success + d.failed + d.cancelled, 0);
  if (!total) return emptyState(host);
  const W = host.clientWidth || 600, H = 270;
  const m = { l: 40, r: 8, t: 18, b: 28 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const peak = Math.max(...days.map((d) => d.success + d.failed + d.cancelled));
  const { max, step } = niceScale(peak);
  const y = (v) => m.t + ph - (v / max) * ph;
  const slot = pw / days.length;
  const bw = Math.max(2, Math.min(24, slot * 0.66));

  host.innerHTML = "";
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": `Questions per day, ${total} in total` }, host);
  for (let v = 0; v <= max; v += step) {
    svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "baseline" : "gridline" }, svg);
    svgEl("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = fmtInt(v);
  }
  const band = svgEl("rect", { class: "hover-band", y: m.t, height: ph, width: slot, x: -999 }, svg);
  const labelEvery = Math.ceil(days.length / (W < 500 ? 4 : 8));
  const groups = [];
  days.forEach((d, i) => {
    const cx = m.l + slot * i + slot / 2;
    const g = svgEl("g", { class: "mark" }, svg);
    let base = y(0);
    const segs = SERIES.filter((s) => d[s.key] > 0);
    segs.forEach((s, j) => {
      const h = (d[s.key] / max) * ph;
      const top = j === segs.length - 1;
      const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const hh = Math.max(0, h - gap);
      const yy = base - gap - hh;
      svgEl("path", { d: top ? barPath(cx - bw / 2, yy, bw, hh) : `M${cx - bw / 2},${yy}h${bw}v${hh}h${-bw}Z`, fill: s.color, class: "grow", style: `animation-delay:${i * 12}ms` }, g);
      base = yy;
    });
    groups.push(g);
    if (i % labelEvery === 0 || days.length <= 8) {
      svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle" }, svg).textContent =
        days.length <= 8 ? dateLabel(d.date, { weekday: "short", day: "numeric" }) : dateLabel(d.date);
    }
  });
  // label only the busiest day
  const pi = days.findIndex((d) => d.success + d.failed + d.cancelled === peak);
  svgEl("text", { x: m.l + slot * pi + slot / 2, y: y(peak) - 6, "text-anchor": "middle", class: "val" }, svg).textContent = fmtInt(peak);

  const hit = svgEl("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "hit" }, svg);
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const scale = W / r.width;
    const i = Math.min(days.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) * scale - m.l) / slot)));
    const d = days[i];
    band.setAttribute("x", m.l + slot * i);
    host.classList.add("is-hovering");
    groups.forEach((g, k) => g.classList.toggle("is-hot", k === i));
    const t = d.success + d.failed + d.cancelled;
    showTip(
      `<h4>${esc(dateLabel(d.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</h4>` +
        SERIES.map((s) => tipRow(s.label, d[s.key], s.color)).join("") +
        tipRow("Total", t),
      e.clientX,
      r.top + (y(t) / scale),
    );
  });
  hit.addEventListener("pointerleave", () => {
    band.setAttribute("x", -999);
    host.classList.remove("is-hovering");
    groups.forEach((g) => g.classList.remove("is-hot"));
    hideTip();
  });
}

function hBars(host, rows, { color = "var(--series-ok)", tooltip, limit = 10 } = {}) {
  rows = rows.slice(0, limit);
  if (!rows.length) return emptyState(host);
  const W = host.clientWidth || 400;
  const rowH = 42, bh = 14;
  const H = rows.length * rowH + 4;
  const max = Math.max(...rows.map((r) => r.value));
  const valW = 46;
  const pw = W - valW;
  host.innerHTML = "";
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" }, host);
  const marks = [];
  rows.forEach((r, i) => {
    const y0 = i * rowH;
    const g = svgEl("g", { class: "mark" }, svg);
    svgEl("text", { x: 0, y: y0 + 13, class: "lbl" }, g).textContent = r.label;
    svgEl("rect", { x: 0, y: y0 + 20, width: pw, height: bh, rx: 4, fill: "rgba(255,255,255,0.04)" }, g);
    const w = Math.max(3, (r.value / max) * pw);
    svgEl("path", { d: barPath(0, y0 + 20, w, bh, { horizontal: true }), fill: r.color || color, class: "grow-x", style: `animation-delay:${i * 50}ms` }, g);
    svgEl("text", { x: w + 8, y: y0 + 31, class: "val" }, g).textContent = fmtInt(r.value);
    const hit = svgEl("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" }, g);
    hit.addEventListener("pointermove", (e) => {
      host.classList.add("is-hovering");
      marks.forEach((m) => m.classList.toggle("is-hot", m === g));
      showTip(tooltip ? tooltip(r) : `<h4>${esc(r.label)}</h4>${tipRow("Questions", fmtInt(r.value))}`, e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => {
      host.classList.remove("is-hovering");
      marks.forEach((m) => m.classList.remove("is-hot"));
      hideTip();
    });
    marks.push(g);
  });
  // keep long labels inside the card
  for (const t of svg.querySelectorAll(".lbl")) {
    while (t.getComputedTextLength() > W - 4 && t.textContent.length > 4) t.textContent = t.textContent.slice(0, -2) + "…";
  }
}

function hourColumns(host, hours) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) return emptyState(host);
  const W = host.clientWidth || 400, H = 230;
  const m = { l: 34, r: 4, t: 18, b: 26 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const peak = Math.max(...hours);
  const { max, step } = niceScale(peak);
  const y = (v) => m.t + ph - (v / max) * ph;
  const slot = pw / 24;
  const bw = Math.min(24, slot - 2); // 2px surface gap between adjacent columns
  host.innerHTML = "";
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": "Questions by hour of day" }, host);
  for (let v = 0; v <= max; v += step) {
    svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "baseline" : "gridline" }, svg);
    svgEl("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" }, svg).textContent = fmtInt(v);
  }
  const marks = [];
  hours.forEach((v, h) => {
    const cx = m.l + slot * h + slot / 2;
    const g = svgEl("g", { class: "mark" }, svg);
    if (v > 0) svgEl("path", { d: barPath(cx - bw / 2, y(v), bw, y(0) - y(v)), fill: "var(--series-ok)", class: "grow", style: `animation-delay:${h * 20}ms` }, g);
    if (h % 3 === 0) svgEl("text", { x: cx, y: H - 8, "text-anchor": "middle" }, svg).textContent = String(h).padStart(2, "0");
    if (v === peak) svgEl("text", { x: cx, y: y(v) - 6, "text-anchor": "middle", class: "val" }, svg).textContent = fmtInt(v);
    const hit = svgEl("rect", { x: cx - slot / 2, y: m.t, width: slot, height: ph, class: "hit" }, svg);
    hit.addEventListener("pointermove", (e) => {
      host.classList.add("is-hovering");
      marks.forEach((mm, k) => mm.classList.toggle("is-hot", k === h));
      showTip(`<h4>${String(h).padStart(2, "0")}:00 – ${String((h + 1) % 24).padStart(2, "0")}:00</h4>${tipRow("Questions", fmtInt(v))}${tipRow("Share", fmtPct(v / total))}`, e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => {
      host.classList.remove("is-hovering");
      marks.forEach((mm) => mm.classList.remove("is-hot"));
      hideTip();
    });
    marks.push(g);
  });
}

function sparkline(svg, days) {
  svg.innerHTML = "";
  const vals = days.map((d) => d.success + d.failed + d.cancelled);
  if (vals.length < 2 || !vals.some(Boolean)) return;
  const W = 200, H = 52, max = Math.max(...vals);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - 4 - (v / max) * (H - 10)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  svgEl("path", { d: `${line}L${W},${H}L0,${H}Z`, fill: "rgba(14,196,243,0.10)", stroke: "none" }, svg);
  svgEl("path", { d: line, stroke: "var(--cyan)", "stroke-width": 2, fill: "none", "vector-effect": "non-scaling-stroke" }, svg);
}

function feedbackViz(host, t) {
  const total = t.feedbackUp + t.feedbackDown;
  if (!total) return emptyState(host, "No ratings yet");
  host.innerHTML = `
    <div class="fb-big">${fmtPct(t.satisfaction, 0)}<small>found it helpful</small></div>
    <div class="fb-row"><span><i class="key key--ok"></i> Helpful</span><span class="fb-bar"><i style="background:var(--series-ok)"></i></span><b>${fmtInt(t.feedbackUp)}</b></div>
    <div class="fb-row"><span><i class="key key--fail"></i> Not helpful</span><span class="fb-bar"><i style="background:var(--series-fail)"></i></span><b>${fmtInt(t.feedbackDown)}</b></div>
    <p class="muted">${fmtPct(total / Math.max(1, t.success), 0)} of successful answers were rated.</p>`;
  const bars = $$(".fb-bar i", host);
  requestAnimationFrame(() => {
    bars[0].style.width = `${(t.feedbackUp / total) * 100}%`;
    bars[1].style.width = `${(t.feedbackDown / total) * 100}%`;
  });
}

/* ---------------- table views ---------------- */
function tableHtml(head, rows) {
  return `<table><thead><tr>${head.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

const TABLES = {
  daily: (d) => tableHtml(["Date", "Succeeded", "Failed", "Cancelled"], [...d.byDay].reverse().map((r) => [r.date, r.success, r.failed, r.cancelled])),
  category: (d) => tableHtml(["Category", "Questions", "Failed"], d.byCategory.map((r) => [r.name, r.total, r.failed])),
  schools: (d) => tableHtml(["School", "Questions", "Failed", "Flagged"], d.bySchool.map((r) => [r.partner ? `${r.name} (partner)` : r.name, r.total, r.failed, r.flagged])),
  hours: (d) => tableHtml(["Hour", "Questions"], d.byHour.map((v, h) => [`${String(h).padStart(2, "0")}:00`, v])),
  errors: (d) => tableHtml(["Reason", "Count"], d.errors.map((r) => [ERROR_LABELS[r.type] || r.type, r.count])),
  countries: (d) => tableHtml(["Country", "Questions"], d.byCountry.map((r) => [r.name, r.total])),
};

/* ---------------- render ---------------- */
function animateValue(el, to, format) {
  if (to == null || matchMedia("(prefers-reduced-motion: reduce)").matches) return (el.textContent = format(to));
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / 900);
    el.textContent = format(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function delta(el, cur, prev, { points = false, label }) {
  if (cur == null || prev == null || state.days === "all") return (el.innerHTML = "");
  if (!points && prev === 0) return (el.innerHTML = `<span>new vs ${label}</span>`);
  const diff = points ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  const dir = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
  el.innerHTML = `<b class="${dir}">${arrow} ${Math.abs(diff).toFixed(1)}${points ? " pts" : "%"}</b> vs ${label}`;
}

function render() {
  const d = state.data;
  const t = d.totals;
  const prevLabel = d.range.days ? `previous ${d.range.days} days` : "";

  $("#demo-banner").hidden = !d.demo;
  $("#storage-banner").hidden = d.demo || d.storage !== "temporary";
  $("#empty-banner").hidden = d.demo || t.total > 0;
  $("#updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("#range-note").textContent = `${d.range.days ? `Last ${d.range.days} days` : "All time"} · times in ${d.range.timeZone.replace("_", " ")}`;
  $("#hours-note").textContent = `Questions by hour of day (${d.range.timeZone.split("/").pop().replace("_", " ")} time)`;

  // Options follow the schools seen in this range; keep the current choice even if it drops out.
  const sel = $("#school-filter");
  const options = d.schoolOptions.filter((s) => s.key !== "__none__");
  if (state.school && !options.some((s) => s.key === state.school)) options.unshift({ key: state.school, name: state.schoolName || state.school });
  sel.replaceChildren(
    new Option("All schools", ""),
    ...(d.schoolOptions.some((s) => s.key === "__none__") ? [new Option("No specific school", "__none__")] : []),
    ...options.map((s) => new Option(s.partner ? `${s.name} (partner)` : s.name, s.key)),
  );
  sel.value = state.school;

  const set = (key, value, fmt) => animateValue($(`[data-kpi="${key}"]`), value, fmt);
  set("total", t.total, (v) => fmtInt(Math.round(v)));
  set("success", t.success, (v) => fmtInt(Math.round(v)));
  set("failed", t.failed, (v) => fmtInt(Math.round(v)));
  set("successRate", t.successRate, (v) => fmtPct(v));
  set("p50LatencyMs", t.p50LatencyMs, fmtSecs);
  set("uniqueVisitors", t.uniqueVisitors, (v) => fmtInt(Math.round(v)));
  set("satisfaction", t.satisfaction, (v) => fmtPct(v, 0));
  set("avgSources", t.avgSources, (v) => (v == null ? "–" : v.toFixed(1)));
  set("searches", t.searches, (v) => fmtInt(Math.round(v)));
  set("estCostUsd", t.estCostUsd, fmtUsd);
  set("cancelled", t.cancelled, (v) => fmtInt(Math.round(v)));
  set("flagged", t.flagged, (v) => fmtInt(Math.round(v)));
  $('[data-sub="flagged"]').textContent = t.total ? `${fmtPct(t.flagged / t.total)} outside school research` : "";

  const share = (n) => (t.total ? `${fmtPct(n / t.total)} of all questions` : "");
  $('[data-sub="success"]').textContent = share(t.success);
  $('[data-sub="failed"]').textContent = share(t.failed);
  $('[data-sub="latency"]').textContent = t.p90LatencyMs ? `p90 ${fmtSecs(t.p90LatencyMs)} · first words ${fmtSecs(t.p50FirstTokenMs)}` : "";
  $('[data-sub="visitors"]').textContent = t.uniqueVisitors ? `${(t.total / t.uniqueVisitors).toFixed(1)} questions each` : "";
  $('[data-sub="satisfaction"]').textContent = `${fmtInt(t.feedbackUp + t.feedbackDown)} ratings`;
  $('[data-sub="searches"]').textContent = t.success ? `${(t.searches / Math.max(1, t.total)).toFixed(1)} per question` : "";
  $('[data-sub="cost"]').textContent = !d.costConfigured
    ? "set PRICE_* in .env to enable"
    : t.total ? `≈ ${fmtUsd(t.estCostUsd / t.total)} per question` : "";
  $("#rate-meter").style.width = `${(t.successRate || 0) * 100}%`;
  delta($('[data-delta="total"]'), t.total, d.previous?.total, { label: prevLabel });
  delta($('[data-delta="successRate"]'), t.successRate, d.previous?.successRate, { points: true, label: "prev. period" });

  $("#daily-legend").innerHTML = SERIES.map((s) => `<span><i class="key ${s.cls}"></i>${s.label}</span>`).join("");
  sparkline($("#spark"), d.byDay);
  drawCharts();
  feedbackViz($("#feedback-viz"), t);
  renderRecent();
  $$("[data-table-toggle][aria-pressed='true']").forEach((b) => fillTable(b));
}

function drawCharts() {
  const d = state.data;
  const total = d.totals.total || 1;
  stackedColumns($("#chart-daily"), d.byDay);
  hBars(
    $("#chart-category"),
    d.byCategory.map((c) => ({ label: c.name, value: c.total, raw: c })),
    {
      tooltip: (r) => `<h4>${esc(r.label)}</h4>${tipRow("Questions", fmtInt(r.value))}${tipRow("Share", fmtPct(r.value / total))}${tipRow("Succeeded", fmtInt(r.raw.success), "var(--series-ok)")}${tipRow("Failed", fmtInt(r.raw.failed), "var(--series-fail)")}`,
    },
  );
  hBars(
    $("#chart-schools"),
    d.bySchool.map((s) => ({ label: s.partner ? `${s.name} · partner` : s.name, value: s.total, raw: s })),
    {
      tooltip: (r) =>
        `<h4>${esc(r.raw.name)}</h4>${tipRow("Country", r.raw.country || "–")}${tipRow("StudyIn partner", r.raw.partner ? "Yes" : "No")}` +
        `${tipRow("Questions", fmtInt(r.value))}${tipRow("Failed", fmtInt(r.raw.failed), "var(--series-fail)")}${tipRow("Flagged", fmtInt(r.raw.flagged))}`,
    },
  );
  hourColumns($("#chart-hours"), d.byHour);
  const failedTotal = d.errors.reduce((a, e) => a + e.count, 0);
  if (!failedTotal) emptyState($("#chart-errors"), "No failures in this period");
  else
    hBars(
      $("#chart-errors"),
      d.errors.map((e) => ({ label: ERROR_LABELS[e.type] || e.type, value: e.count })),
      { color: "var(--series-fail)", tooltip: (r) => `<h4>${esc(r.label)}</h4>${tipRow("Failures", fmtInt(r.value))}${tipRow("Share of failures", fmtPct(r.value / failedTotal))}` },
    );
  hBars(
    $("#chart-countries"),
    d.byCountry.map((c) => ({ label: c.name, value: c.total })),
    { tooltip: (r) => `<h4>${esc(r.label)}</h4>${tipRow("Questions", fmtInt(r.value))}${tipRow("Share", fmtPct(r.value / total))}` },
  );
}

const STATUS_ICON = {
  success: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  failed: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  cancelled: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
};
const STATUS_LABEL = { success: "Succeeded", failed: "Failed", cancelled: "Cancelled" };

function renderRecent() {
  const q = $("#recent-search").value.trim().toLowerCase();
  const rows = state.data.recent.filter((r) => !q || `${r.prompt} ${r.schoolName} ${r.category}`.toLowerCase().includes(q));
  const body = $("#recent-table tbody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">No questions to show.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((r, i) => {
      const when = new Date(r.ts);
      const st = r.status in STATUS_LABEL ? r.status : "failed";
      return `<tr class="${r.flagged ? "is-flagged" : ""}" style="animation-delay:${Math.min(i, 20) * 20}ms">
        <td title="${esc(when.toLocaleString())}">${esc(when.toLocaleDateString([], { month: "short", day: "numeric" }))}<span class="err-type">${esc(when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span></td>
        <td>${r.schoolName ? esc(r.schoolName) : '<span class="muted">No specific school</span>'}${r.partner ? '<span class="partner-pill">Partner</span>' : ""}</td>
        <td>${esc(r.category || "–")}</td>
        <td class="q">${r.flagged ? '<span class="flag-pill"><i class="flag-ico"></i>Off-topic</span>' : ""}<span title="${esc(r.prompt)}">${esc(r.prompt)}</span></td>
        <td><span class="status status--${st}">${STATUS_ICON[st]}${STATUS_LABEL[st]}</span>${r.status === "failed" ? `<span class="err-type">${esc(ERROR_LABELS[r.errorType] || r.errorType || "")}</span>` : ""}</td>
        <td class="num">${r.status === "success" ? fmtSecs(r.latencyMs) : "–"}</td>
        <td class="num">${r.sourceCount ?? "–"}</td>
        <td>${r.feedback === "up" ? "Helpful" : r.feedback === "down" ? "Not helpful" : "–"}</td>
      </tr>`;
    })
    .join("");
}

function fillTable(btn) {
  const card = btn.closest(".card");
  card.querySelector(".table-view").innerHTML = TABLES[card.dataset.chart](state.data);
}

/* ---------------- data ---------------- */
async function api(path) {
  const res = await fetch(path, { headers: state.key ? { "x-admin-key": state.key } : {} });
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "Access denied");
    err.gate = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res;
}

function query() {
  const p = new URLSearchParams({ days: state.days });
  if (state.school) p.set("school", state.school);
  if (state.flagged) p.set("flagged", "1");
  if (state.demo) p.set("demo", "1");
  return p.toString();
}

async function load() {
  const btn = $("#refresh");
  btn.classList.add("is-spinning");
  try {
    state.data = await (await api(`/api/analytics?${query()}`)).json();
    $("#gate").hidden = true;
    render();
  } catch (err) {
    if (err.gate) {
      $("#gate").hidden = false;
      $("#gate-msg").textContent = state.key ? err.message : "Enter the admin key to view the dashboard.";
      $("#gate-key").focus();
    } else {
      $("#updated").textContent = "Couldn't load data";
      console.error(err);
    }
  } finally {
    btn.classList.remove("is-spinning");
  }
}

/* ---------------- wiring ---------------- */
$("#range").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b) return;
  state.days = b.dataset.days;
  $$("#range button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  load();
});
$("#school-filter").addEventListener("change", (e) => {
  state.school = e.target.value;
  state.schoolName = e.target.selectedOptions[0]?.textContent || "";
  load();
});
$("#flagged-toggle").addEventListener("change", (e) => {
  state.flagged = e.target.checked;
  load();
});
$("#demo-toggle").addEventListener("change", (e) => {
  state.demo = e.target.checked;
  state.school = ""; // sample and real data have different schools
  load();
});
$("#refresh").addEventListener("click", load);
$("#recent-search").addEventListener("input", () => state.data && renderRecent());
$("#export").addEventListener("click", async () => {
  try {
    const blob = await (await api(`/api/analytics/export.csv?${query()}`)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `studyin-ai-queries${state.demo ? "-sample" : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    alert(err.message);
  }
});
$$("[data-table-toggle]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const card = btn.closest(".card");
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Chart" : "Table";
    card.querySelector(".chart").hidden = on;
    card.querySelector(".table-view").hidden = !on;
    if (on && state.data) fillTable(btn);
    else if (state.data) drawCharts();
  }),
);
$("#gate-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.key = $("#gate-key").value;
  try { sessionStorage.setItem("studyin.adminKey", state.key); } catch { /* session only */ }
  load();
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data && drawCharts(), 150);
}).observe($(".grid"));

setInterval(() => {
  if (!document.hidden && !state.demo && $("#gate").hidden) load();
}, 60_000);

load();
