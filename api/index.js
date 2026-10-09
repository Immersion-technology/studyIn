// Vercel entry point: vercel.json rewrites every /api/<route> request here as
// /api?__route=<route>, and this hands it to the same Express app that
// `npm start` runs locally.
import app from "../server.js";

export default function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const route = url.searchParams.get("__route");
  if (route !== null) {
    url.searchParams.delete("__route");
    // Restore the original path if the platform passed the rewritten one.
    if (url.pathname === "/api" || url.pathname === "/api/") url.pathname = `/api/${route}`;
    req.url = url.pathname + url.search;
  }
  return app(req, res);
}
