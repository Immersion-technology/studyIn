import { CATEGORIES, MODEL } from "./ai.js";

// Synthetic records for previewing the dashboard. Generated in memory only and
// never written to the real log.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORY_WEIGHTS = [16, 18, 15, 13, 10, 9, 8, 6, 3, 2];
const SAMPLE_PROMPTS = {
  "Admissions & Entry Requirements": "What WAEC grades do I need for a BSc in Computer Science?",
  "Tuition & Fees": "How much is tuition for an MSc in Data Science for international students?",
  "Scholarships & Funding": "Are there scholarships for Nigerian students starting in January?",
  "Visa & Immigration": "What documents do I need for the student visa, and how much proof of funds?",
  "Courses & Programmes": "Which postgraduate programmes in Public Health are available?",
  "Accommodation & Living Costs": "What does on-campus accommodation cost per month?",
  "Application Process & Deadlines": "When is the deadline for the September intake?",
  "Careers & Post-Study Work": "Can I work after graduation, and for how long?",
  "Student Life & Support": "Is there an African students society and support for new arrivals?",
  Other: "Tell me about the city and the weather.",
};
const ERRORS = [["overloaded", 5], ["timeout", 3], ["rate_limited", 2], ["connection", 1], ["server_error", 1]];

function pick(r, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < items.length; i++) if ((x -= weights[i]) < 0) return items[i];
  return items[items.length - 1];
}

// Generic stand-ins for schools visitors type in. `null` = no school named.
const TYPED_SCHOOLS = [
  ["Sample School A", "United Kingdom"],
  ["Sample School B", "United Kingdom"],
  ["Sample School C", "Canada"],
  ["Sample School D", "Ireland"],
  ["Sample School E", "United States"],
  ["Sample School F", "Australia"],
  ["Sample School G", "Germany"],
  null,
].map((s) => (s ? { name: s[0], country: s[1], partner: false } : null));

const OFF_TOPIC_PROMPTS = [
  "Can you write my football club's match report?",
  "Help me fix this JavaScript error",
  "Who will win the election?",
  "Write a love poem for my girlfriend",
];

export function demoRecords(partners, now = Date.now()) {
  const schools = [...partners.map((s) => ({ ...s, partner: true })), ...TYPED_SCHOOLS];
  const r = rng(20261009);
  const out = [];
  const schoolWeights = schools.map((_, i) => Math.max(1, 14 - i * 0.9 + r() * 4));
  const visitors = Array.from({ length: 900 }, (_, i) => `demo-${i}`);
  for (let day = 89; day >= 0; day--) {
    const growth = 1 + (89 - day) / 60;
    const weekday = new Date(now - day * 86_400_000).getUTCDay();
    const base = (weekday === 0 || weekday === 6 ? 9 : 15) * growth;
    const n = Math.round(base + r() * 8);
    for (let i = 0; i < n; i++) {
      const hour = Math.floor(pick(r, [8, 10, 12, 14, 16, 18, 20, 22, 1], [3, 6, 7, 7, 8, 9, 10, 6, 1]) + r() * 2) % 24;
      const ts = new Date(now - day * 86_400_000).setUTCHours(hour - 1, Math.floor(r() * 60), Math.floor(r() * 60));
      if (ts > now) continue;
      const flagged = r() < 0.06;
      const school = flagged ? null : pick(r, schools, schoolWeights);
      const category = flagged ? "Other" : pick(r, CATEGORIES, CATEGORY_WEIGHTS);
      const roll = r();
      const status = roll < 0.045 ? "failed" : roll < 0.075 ? "cancelled" : "success";
      // Off-topic questions get a short redirect without any research.
      const searches = flagged ? 0 : status === "success" ? 2 + Math.floor(r() * 5) : Math.floor(r() * 2);
      const latencyMs = flagged
        ? Math.round(3000 + r() * 4000)
        : status === "success" ? Math.round(22_000 + r() * 38_000 + searches * 2500) : Math.round(4000 + r() * 30000);
      out.push({
        id: `demo-${out.length}`,
        ts: new Date(ts).toISOString(),
        visitorId: visitors[Math.floor(r() * r() * visitors.length)],
        schoolId: school?.partner ? school.id : null,
        schoolName: school?.name ?? null,
        partner: Boolean(school?.partner),
        country: school?.country ?? null,
        prompt: flagged ? OFF_TOPIC_PROMPTS[Math.floor(r() * OFF_TOPIC_PROMPTS.length)] : SAMPLE_PROMPTS[category],
        category,
        flagged,
        status,
        errorType: status === "failed" ? pick(r, ERRORS.map((e) => e[0]), ERRORS.map((e) => e[1])) : null,
        latencyMs,
        firstTokenMs: status === "success" ? Math.round(latencyMs * (0.35 + r() * 0.25)) : null,
        inputTokens: status === "success" ? Math.round(18_000 + r() * 30_000) : Math.round(r() * 8000),
        outputTokens: status === "success" ? Math.round(1800 + r() * 2600) : Math.round(r() * 400),
        searches,
        sourceCount: status === "success" && !flagged ? 4 + Math.floor(r() * 12) : 0,
        model: MODEL,
        feedback: status === "success" && r() < 0.32 ? (r() < 0.87 ? "up" : "down") : null,
      });
    }
  }
  return out;
}
