import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import express from "express";
import { askAI, classifyQuestion, describeError, keywordClassify, CATEGORIES, MODEL } from "./lib/ai.js";
import { aggregate, appendFeedback, appendQuery, applyFilters, hasQuery, overLimit, readQueries, toCsv, STORAGE } from "./lib/store.js";
import { demoRecords } from "./lib/demo.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ON_VERCEL = Boolean(process.env.VERCEL);
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_10_MIN || 12);
const MAX_PROMPT = 1500;
const MAX_SCHOOL = 120;
const DAY_MS = 86_400_000;

// Optional list of StudyIn partner schools. Visitors can still ask about any school.
const { schools } = require("./data/schools.json");
const schoolById = new Map(schools.map((s) => [s.id, s]));

const app = express();
// Vercel and most hosts sit behind a proxy; trust it so req.ip is the visitor's address.
if (process.env.TRUST_PROXY || ON_VERCEL) app.set("trust proxy", process.env.TRUST_PROXY || true);
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Local development only: on Vercel, files in public/ are served by the CDN.
app.use(express.static(path.join(here, "public"), { extensions: ["html"] }));

// ---------- helpers ----------
const hashVisitor = (id) =>
  id ? crypto.createHash("sha256").update(String(id).slice(0, 64)).digest("hex").slice(0, 16) : null;

const isLoopback = (ip = "") => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    if (!ON_VERCEL && isLoopback(req.socket.remoteAddress)) return next();
    return res.status(403).json({ error: "Set ADMIN_KEY on the server to view analytics." });
  }
  const given = Buffer.from(String(req.get("x-admin-key") || ""));
  const want = Buffer.from(ADMIN_KEY);
  if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
  return res.status(401).json({ error: "Invalid admin key." });
}

/** A partner school picked from the list, a school the visitor typed, or null. */
function resolveSchool(body) {
  const partner = schoolById.get(String(body?.schoolId || ""));
  if (partner) return { ...partner, partner: true };
  const typed = String(body?.school || "")
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SCHOOL);
  if (!typed) return null;
  const match = schools.find((s) => s.name.toLowerCase() === typed.toLowerCase() || s.short?.toLowerCase() === typed.toLowerCase());
  return match ? { ...match, partner: true } : { name: typed, partner: false };
}

// ---------- public API ----------
app.get("/api/config", (_req, res) => {
  res.json({
    schools,
    categories: CATEGORIES,
    maxPromptChars: MAX_PROMPT,
    maxSchoolChars: MAX_SCHOOL,
    contact: {
      email: process.env.CONTACT_EMAIL || "lagos@gostudyin.com",
      phone: process.env.CONTACT_PHONE || "+234 810 912 4550",
    },
  });
});

app.post("/api/ask", async (req, res) => {
  const school = resolveSchool(req.body);
  const prompt = String(req.body?.prompt || "").trim();
  const visitorId = hashVisitor(req.body?.visitorId);

  if (prompt.length < 3) return res.status(400).json({ error: "Please type a question." });
  if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: `Please keep your question under ${MAX_PROMPT} characters.` });

  const queryId = crypto.randomUUID();
  const base = {
    id: queryId,
    ts: new Date().toISOString(),
    visitorId,
    schoolId: school?.partner ? school.id : null,
    schoolName: school?.name ?? null,
    schoolTyped: school && !school.partner ? school.name : null,
    partner: Boolean(school?.partner),
    country: school?.country ?? null,
    prompt: prompt.slice(0, 500),
    promptChars: prompt.length,
  };
  const labels = (c) => ({
    category: c.category,
    categoryVia: c.via,
    flagged: !c.onTopic,
    schoolName: c.school || base.schoolName,
    country: c.country || base.country,
  });

  if (await overLimit(`ip:${req.ip}`, RATE_LIMIT)) {
    await appendQuery({ ...base, ...labels(keywordClassify(prompt, school)), status: "failed", errorType: "visitor_rate_limit", latencyMs: 0 });
    return res.status(429).json({ error: "You've asked a lot of questions in a short time. Please wait a few minutes and try again." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  let finished = false;
  const send = (event, data) => {
    if (!finished && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const abort = new AbortController();
  res.on("close", () => {
    if (!finished) abort.abort();
  });
  const heartbeat = setInterval(() => send("ping", {}), 15_000);

  send("meta", { queryId, school: school ? { name: school.name, partner: school.partner } : null });
  const classification = classifyQuestion(prompt, school);
  classification.then((c) =>
    send("category", { category: c.category, flagged: !c.onTopic, school: c.school, country: c.country }),
  );

  const record = { ...base, model: MODEL };
  try {
    const result = await askAI({ school, prompt, signal: abort.signal, emit: send });
    Object.assign(record, {
      latencyMs: result.latencyMs,
      firstTokenMs: result.firstTokenMs,
      answerChars: result.answerChars,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheReadTokens: result.usage.cacheRead,
      searches: result.usage.searches,
      fetches: result.usage.fetches,
      sourceCount: result.sources.length,
      model: result.model,
      truncated: result.truncated,
    });
    if (!result.answerChars) {
      record.status = "failed";
      record.errorType = "empty_answer";
      send("error", { message: "We couldn't put together an answer this time. Please try again." });
    } else {
      record.status = "success";
      send("done", {
        queryId,
        latencyMs: result.latencyMs,
        searches: result.usage.searches,
        sources: result.sources.length,
        truncated: result.truncated,
      });
    }
  } catch (err) {
    const { type, message } = describeError(err);
    record.latencyMs = Date.now() - Date.parse(base.ts);
    if (abort.signal.aborted) {
      record.status = "cancelled";
      record.errorType = "cancelled";
    } else {
      record.status = "failed";
      record.errorType = type;
      console.error(`[ask ${queryId}] ${type}:`, err?.message || err);
      send("error", { message });
    }
  } finally {
    clearInterval(heartbeat);
    // Wait for the labels so they reach the browser before the response closes.
    const c = await classification;
    finished = true;
    // Save before ending the response: on Vercel the function may stop once it ends.
    try {
      await appendQuery({ ...record, ...labels(c) });
    } catch (err) {
      console.error(`[ask ${queryId}] could not save analytics record:`, err?.message || err);
    }
    res.end();
  }
});

app.post("/api/feedback", async (req, res) => {
  const queryId = String(req.body?.queryId || "");
  const rating = req.body?.rating;
  if (!/^[0-9a-f-]{36}$/.test(queryId) || !["up", "down"].includes(rating)) {
    return res.status(400).json({ error: "Invalid feedback." });
  }
  try {
    if (!(await hasQuery(queryId))) return res.status(404).json({ error: "Unknown question." });
    await appendFeedback(queryId, rating);
    res.json({ ok: true });
  } catch (err) {
    console.error("[feedback]", err?.message || err);
    res.status(500).json({ error: "Couldn't save feedback." });
  }
});

// ---------- admin API ----------
async function analyticsInput(req) {
  const days = req.query.days === "all" ? null : [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const demo = req.query.demo === "1";
  // Read twice the range so the "vs previous period" comparison has data.
  const fromMs = days ? Date.now() - 2 * days * DAY_MS : 0;
  const all = demo ? demoRecords(schools) : await readQueries(fromMs);
  const filters = { schoolKey: req.query.school ? String(req.query.school) : null, flaggedOnly: req.query.flagged === "1" };
  return { days, demo, all, records: applyFilters(all, filters) };
}

app.get("/api/admin/check", requireAdmin, (_req, res) => res.json({ ok: true }));

app.get("/api/analytics", requireAdmin, async (req, res, next) => {
  try {
    const { days, demo, all, records } = await analyticsInput(req);
    // School filter options come from every school asked about in this range, not only the filtered set.
    const options = aggregate(all, { days }).bySchool.slice(0, 60).map(({ key, name, partner }) => ({ key, name, partner }));
    res.json({ demo, storage: STORAGE, schoolOptions: options, ...aggregate(records, { days }) });
  } catch (err) {
    next(err);
  }
});

app.get("/api/analytics/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const { days, records } = await analyticsInput(req);
    const from = days ? Date.now() - days * DAY_MS : 0;
    const rows = records.filter((q) => Date.parse(q.ts) >= from).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="studyin-ai-queries-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("﻿" + toCsv(rows));
  } catch (err) {
    next(err);
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, _req, res, _next) => {
  console.error("[server]", err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: "Something went wrong." });
});

export default app;

// Vercel runs the exported app as a function; locally we listen on a port.
if (!ON_VERCEL) {
  app.listen(PORT, () => {
    console.log(`StudyIn AI running at http://localhost:${PORT}`);
    console.log(`Analytics dashboard:   http://localhost:${PORT}/analytics`);
    console.log(`Analytics storage:     ${STORAGE}`);
    if (!ADMIN_KEY) console.warn("ADMIN_KEY is not set: analytics is only reachable from this machine.");
    if (!process.env.OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set: questions will fail until you add it to .env.");
  });
}
