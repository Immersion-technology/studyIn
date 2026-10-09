import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

/*
 * Query log storage.
 * - Upstash Redis when its REST credentials are set (UPSTASH_REDIS_REST_URL/TOKEN, or the
 *   KV_REST_API_URL/TOKEN names Vercel injects). Use this on Vercel: function file systems
 *   are read-only and short-lived.
 * - Otherwise JSON Lines files in data/ (local development). On Vercel without Redis the
 *   files go to /tmp and disappear when the function instance is recycled.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const ON_VERCEL = Boolean(process.env.VERCEL);
const hasRedis = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
);
const redis = hasRedis ? Redis.fromEnv() : null;
export const STORAGE = redis ? "redis" : ON_VERCEL ? "temporary" : "file";

const KEY = {
  queries: "studyin:queries", // sorted set: score = timestamp ms, member = record
  ids: "studyin:query-ids", // hash: query id -> timestamp ms
  feedback: "studyin:feedback", // hash: query id -> "up" | "down"
};

const DATA_DIR = process.env.DATA_DIR || (ON_VERCEL ? "/tmp/studyin" : path.join(here, "..", "data"));
const QUERIES_FILE = path.join(DATA_DIR, "queries.jsonl");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback.jsonl");
if (!redis) fs.mkdirSync(DATA_DIR, { recursive: true });

const TZ = process.env.ANALYTICS_TZ || "Africa/Lagos";
const DAY_MS = 86_400_000;

// USD prices for the dashboard's cost estimate, taken from .env so they match
// your model and plan. The estimate stays blank until input and output are set.
const price = (name) => (process.env[name] ? Number(process.env[name]) : null);
const PRICE = {
  input: price("PRICE_INPUT_PER_M"),
  cachedInput: price("PRICE_CACHED_INPUT_PER_M"),
  output: price("PRICE_OUTPUT_PER_M"),
  per1kSearches: price("PRICE_PER_1K_SEARCHES"),
};
const COST_CONFIGURED = Number.isFinite(PRICE.input) && Number.isFinite(PRICE.output);

/* ---------------- writes ---------------- */
export async function appendQuery(record) {
  if (redis) {
    const ms = Date.parse(record.ts);
    await Promise.all([
      redis.zadd(KEY.queries, { score: ms, member: JSON.stringify(record) }),
      redis.hset(KEY.ids, { [record.id]: ms }),
    ]);
    return;
  }
  fs.appendFileSync(QUERIES_FILE, JSON.stringify(record) + "\n");
}

export async function appendFeedback(queryId, rating) {
  if (redis) {
    await redis.hset(KEY.feedback, { [queryId]: rating });
    return;
  }
  fs.appendFileSync(FEEDBACK_FILE, JSON.stringify({ queryId, rating, ts: new Date().toISOString() }) + "\n");
}

/* ---------------- reads ---------------- */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Skip a partially written line rather than failing the whole dashboard.
    }
  }
  return out;
}

export async function hasQuery(queryId) {
  if (redis) return Boolean(await redis.hexists(KEY.ids, queryId));
  return readJsonl(QUERIES_FILE).some((q) => q.id === queryId);
}

/** Records with timestamp >= fromMs (all when omitted), with feedback merged in. */
export async function readQueries(fromMs = 0) {
  let records;
  let feedback;
  if (redis) {
    const [members, fb] = await Promise.all([
      redis.zrange(KEY.queries, fromMs, "+inf", { byScore: true }),
      redis.hgetall(KEY.feedback),
    ]);
    // The client parses JSON members automatically; accept strings too.
    records = members.map((m) => (typeof m === "string" ? JSON.parse(m) : m));
    feedback = new Map(Object.entries(fb || {}));
  } else {
    feedback = new Map(readJsonl(FEEDBACK_FILE).map((f) => [f.queryId, f.rating]));
    records = readJsonl(QUERIES_FILE).filter((q) => Date.parse(q.ts) >= fromMs);
  }
  return records.map((q) => ({ ...q, feedback: feedback.get(q.id) ?? null }));
}

/* ---------------- rate limiting ---------------- */
const memoryHits = new Map();

/** True when this key has used up `limit` requests in the current window. */
export async function overLimit(key, limit, windowSec = 600) {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  if (redis) {
    const k = `studyin:rl:${key}:${bucket}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    return n > limit;
  }
  const k = `${key}:${bucket}`;
  const n = (memoryHits.get(k) || 0) + 1;
  memoryHits.set(k, n);
  if (memoryHits.size > 5000) for (const old of memoryHits.keys()) if (!old.endsWith(`:${bucket}`)) memoryHits.delete(old);
  return n > limit;
}

/* ---------------- aggregation ---------------- */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
const dayKey = (ms) => dayFmt.format(new Date(ms));
const hourOf = (ms) => Number(hourFmt.format(new Date(ms))) % 24;

/** Groups free-typed school names: "university of toronto " and "University of Toronto" match. */
export const schoolKeyOf = (q) =>
  q.schoolId || (q.schoolName ? q.schoolName.trim().toLowerCase().replace(/\s+/g, " ") : "__none__");

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function costOf(q) {
  const cached = PRICE.cachedInput ?? PRICE.input;
  return (
    ((q.inputTokens || 0) * PRICE.input + (q.outputTokens || 0) * PRICE.output + (q.cacheReadTokens || 0) * cached) / 1e6 +
    ((q.searches || 0) * (PRICE.per1kSearches || 0)) / 1000
  );
}

function summarise(rows) {
  const success = rows.filter((q) => q.status === "success");
  const failed = rows.filter((q) => q.status === "failed").length;
  const cancelled = rows.filter((q) => q.status === "cancelled").length;
  const latencies = success.map((q) => q.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const firstTokens = success.map((q) => q.firstTokenMs).filter(Number.isFinite).sort((a, b) => a - b);
  const up = rows.filter((q) => q.feedback === "up").length;
  const down = rows.filter((q) => q.feedback === "down").length;
  const decided = success.length + failed;
  return {
    total: rows.length,
    success: success.length,
    failed,
    cancelled,
    flagged: rows.filter((q) => q.flagged).length,
    noSchool: rows.filter((q) => !q.schoolName).length,
    partner: rows.filter((q) => q.partner).length,
    successRate: decided ? success.length / decided : null,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    p50LatencyMs: percentile(latencies, 50),
    p90LatencyMs: percentile(latencies, 90),
    p50FirstTokenMs: percentile(firstTokens, 50),
    uniqueVisitors: new Set(rows.map((q) => q.visitorId).filter(Boolean)).size,
    inputTokens: rows.reduce((a, q) => a + (q.inputTokens || 0), 0),
    outputTokens: rows.reduce((a, q) => a + (q.outputTokens || 0), 0),
    searches: rows.reduce((a, q) => a + (q.searches || 0), 0),
    avgSources: success.length ? success.reduce((a, q) => a + (q.sourceCount || 0), 0) / success.length : null,
    estCostUsd: COST_CONFIGURED ? rows.reduce((a, q) => a + costOf(q), 0) : null,
    feedbackUp: up,
    feedbackDown: down,
    satisfaction: up + down ? up / (up + down) : null,
  };
}

/** Applies the dashboard's school / flagged filters. */
export function applyFilters(records, { schoolKey = null, flaggedOnly = false } = {}) {
  return records.filter((q) => (!schoolKey || schoolKeyOf(q) === schoolKey) && (!flaggedOnly || q.flagged));
}

/**
 * Builds every dashboard figure from raw query records.
 * `days` = 7 | 30 | 90 | null (all time).
 */
export function aggregate(records, { days = 30, now = Date.now() } = {}) {
  const withMs = records.map((q) => ({ ...q, _ms: Date.parse(q.ts) })).filter((q) => Number.isFinite(q._ms));
  const from = days ? now - days * DAY_MS : Math.min(now, ...withMs.map((q) => q._ms));
  const rows = withMs.filter((q) => q._ms >= from && q._ms <= now);
  const prevRows = days ? withMs.filter((q) => q._ms >= from - days * DAY_MS && q._ms < from) : null;

  const spanDays = Math.min(365, Math.max(1, Math.ceil((now - from) / DAY_MS)));
  const dayIndex = new Map();
  const byDay = [];
  for (let i = spanDays - 1; i >= 0; i--) {
    const key = dayKey(now - i * DAY_MS);
    if (dayIndex.has(key)) continue;
    dayIndex.set(key, byDay.length);
    byDay.push({ date: key, success: 0, failed: 0, cancelled: 0, flagged: 0 });
  }
  const byHour = Array(24).fill(0);
  const cats = new Map();
  const schools = new Map();
  const countries = new Map();
  for (const q of rows) {
    const d = byDay[dayIndex.get(dayKey(q._ms))];
    if (d) {
      if (d[q.status] !== undefined) d[q.status]++;
      if (q.flagged) d.flagged++;
    }
    byHour[hourOf(q._ms)]++;

    const catName = q.category || "Other";
    const c = cats.get(catName) || { name: catName, total: 0, success: 0, failed: 0 };
    c.total++;
    if (q.status === "success") c.success++;
    if (q.status === "failed") c.failed++;
    cats.set(catName, c);

    const key = schoolKeyOf(q);
    const s = schools.get(key) || { key, name: q.schoolName || "No specific school", partner: Boolean(q.partner), country: q.country || null, total: 0, failed: 0, flagged: 0 };
    s.total++;
    if (q.status === "failed") s.failed++;
    if (q.flagged) s.flagged++;
    if (!s.country && q.country) s.country = q.country;
    schools.set(key, s);

    const country = q.country || "Not specified";
    countries.set(country, (countries.get(country) || 0) + 1);
  }

  const desc = (a, b) => b.total - a.total;
  const errorCounts = new Map();
  for (const q of rows) if (q.status === "failed") errorCounts.set(q.errorType || "unknown", (errorCounts.get(q.errorType || "unknown") || 0) + 1);

  return {
    range: { days, from: new Date(from).toISOString(), to: new Date(now).toISOString(), timeZone: TZ },
    costConfigured: COST_CONFIGURED,
    totals: summarise(rows),
    previous: prevRows ? summarise(prevRows) : null,
    byDay,
    byHour,
    byCategory: [...cats.values()].sort(desc),
    bySchool: [...schools.values()].sort(desc),
    byCountry: [...countries].map(([name, total]) => ({ name, total })).sort(desc),
    errors: [...errorCounts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    recent: rows
      .sort((a, b) => b._ms - a._ms)
      .slice(0, 40)
      .map(({ _ms, visitorId, ...q }) => q),
  };
}

export function toCsv(records) {
  const cols = [
    "id", "ts", "schoolName", "partner", "country", "category", "flagged", "status", "errorType", "latencyMs",
    "firstTokenMs", "inputTokens", "outputTokens", "searches", "sourceCount", "feedback", "model", "prompt",
  ];
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    // Visitor text must not run as a spreadsheet formula when the CSV is opened.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...records.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}
