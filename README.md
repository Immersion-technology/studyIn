# StudyIn AI

A study-abroad research assistant for StudyIn's website. A prospective student types any school (or none) and a
question, and the AI searches the web (official school and government pages first) and streams back a structured,
cited brief: a direct answer, an "At a glance" table, detailed sections, tips and next steps.

Every question is classified. Questions outside school research (general chat, homework, sport, coding and so on)
are **flagged**: the visitor sees a notice, the AI replies with a short redirect instead of researching, and the
dashboard counts and highlights them.

An analytics dashboard (`/analytics`) tracks usage: questions over time, success and failure, failure reasons,
query categories, flagged questions, most-asked schools, destination countries, hour of day, ratings, tokens and
searches, with CSV export.

## Run locally

```bash
npm install
cp .env.example .env      # then set OPENAI_API_KEY and ADMIN_KEY
npm start                 # http://localhost:3000  ·  analytics at /analytics
```

Node 20+ is required. Locally, analytics records go to `data/queries.jsonl` and `data/feedback.jsonl`.

## Deploy to Vercel

Vercel runs `server.js` as a single function (zero-config Express) and serves `public/` from its CDN.

1. Push this folder to a GitHub/GitLab/Bitbucket repository and import it at <https://vercel.com/new>, or run
   `npx vercel` in this folder. Keep the default settings: no build command and no framework preset are needed.
2. In the project's **Settings → Environment Variables**, add:
   - `OPENAI_API_KEY`: your OpenAI key (the account needs credits).
   - `ADMIN_KEY`: a long random password for the dashboard.
   - Optional: `OPENAI_MODEL`, `CLASSIFIER_MODEL`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `PRICE_*`. See `.env.example`.
3. In the project's **Storage** tab, add **Upstash Redis** from the Marketplace and connect it to the project. This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which the app picks up.
4. Redeploy so the new variables take effect.

Without Redis, the app still works on Vercel, but analytics records live in the function's temporary `/tmp` and
are lost when it restarts. The dashboard shows a warning banner when that is the case.

Answers can take a minute or more. Vercel's default function limit (300 seconds on every plan) covers this, and
the server sends a heartbeat every 15 seconds while it works.

## How it works

| Part | File |
|---|---|
| Server, API routes, rate limit, admin auth (exports the app for Vercel; listens locally) | `server.js` |
| OpenAI calls: research (Responses API + `web_search`), classifier, error mapping | `lib/ai.js` |
| Storage (Upstash Redis or local files), dashboard aggregation, CSV export | `lib/store.js` |
| Generated sample data for previewing the dashboard (never saved) | `lib/demo.js` |
| Optional StudyIn partner school list | `data/schools.json` |
| Visitor site | `public/index.html`, `public/css/styles.css`, `public/js/app.js` |
| Analytics dashboard | `public/analytics.html`, `public/css/analytics.css`, `public/js/analytics.js` |
| Browser libraries (marked, DOMPurify) | `public/vendor/` |

- **Any school works.** The school field is free text and optional. The classifier (`CLASSIFIER_MODEL`, structured
  output) returns the category, whether the question is on topic, the official school name (so "uni of toronto"
  and "University of Toronto" group together on the dashboard) and its country. If the classifier is unavailable,
  a keyword matcher fills in.
- **Partner schools are optional.** Schools added to `data/schools.json` appear as suggestions and quick picks,
  carry a "Partner" badge, and get their official website passed to the AI. Each entry needs `id`, `name`,
  `short`, `country`, `cc` (a flag in `public/img/flags/`: gb, ie, ca, us, au and de are included), `city` and
  `website`.
- **Answers** stream over Server-Sent Events, so visitors see the searches, sources and answer appear live.
- **Every question is logged** with school, partner or not, country, category, flagged, status (`success` /
  `failed` / `cancelled`), error type, latency, tokens, searches and sources. Visitor IDs are stored only as a
  truncated hash.

## Before going live

1. **ADMIN_KEY:** set it. On Vercel, the dashboard is locked without it.
2. **OpenAI credits:** the account behind `OPENAI_API_KEY` must have credits, or every question fails (logged as
   "API credits exhausted").
3. **Cost estimate:** set the `PRICE_*` variables from your model's pricing page to show estimated spend.
4. **Rate limit:** each visitor IP gets `RATE_LIMIT_PER_10_MIN` questions per 10 minutes (default 12). This is
   enforced through Redis on Vercel.

## Brand assets

Colours, type and imagery come from the StudyIn logo (`IMG_3257.png`) and the ad video: navy `#051634`, cyan
`#0EC4F3`, red `#ED1A3E`, bold italic serif headlines, and chevron patterns. Photos in `public/img/` are frames
cropped from the ad. Flags in `public/img/flags/` are local SVGs (Windows doesn't render flag emoji).
