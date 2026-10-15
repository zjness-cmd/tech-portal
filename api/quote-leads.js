// Serves/manages website quote-request leads that api/quote-lead.js writes
// to Firebase Realtime Database, so QuoteGenerator.jsx (running in the
// tech's own browser) can show them without the browser itself needing the
// Firebase database secret. The /quoteLeads path is locked down in
// Firebase's security rules (no public read/write, unlike /golfRooms) —
// only this file and api/quote-lead.js hold FIREBASE_DB_SECRET and can
// touch it, via Firebase's legacy REST `?auth=<secret>` param.
//
// Also doubles as the push-subscription save/remove endpoint (folded in
// here, rather than its own api/push-subscribe.js file, specifically to
// stay under Vercel Hobby's 12-serverless-function-per-deployment cap —
// adding a 13th api/*.js file broke the build) for the "🔔 notify me about
// new leads" bell in QuoteGenerator.jsx. Distinguished from the
// dismiss-lead case by body shape, not a query param, so this stays a
// single POST/DELETE pair instead of growing more routes.
//
// GET  -> { leads: [...] }                      list all pending leads, newest first
// POST { id } -> { ok: true }                   dismiss (delete) one lead by its Firebase key
// POST { subscription } -> { ok: true }          save/overwrite this device's push subscription
// DELETE { endpoint } -> { ok: true }            remove this device's push subscription
const { keyFor } = require("./_push");

export default async function handler(req, res) {
  const dbUrl = process.env.VITE_FIREBASE_DB_URL;
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!dbUrl || !secret) {
    return res.status(500).json({ error: "VITE_FIREBASE_DB_URL and/or FIREBASE_DB_SECRET not set in Vercel env vars." });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(dbUrl + "/quoteLeads.json?auth=" + secret);
      const data = await r.json();
      const leads = Object.entries(data || {})
        .map(([id, lead]) => ({ id, ...lead }))
        .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
      return res.status(200).json({ leads });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    if (req.method === "POST" && body?.subscription) {
      const subscription = body.subscription;
      if (!subscription?.endpoint) return res.status(400).json({ error: "Missing subscription" });
      await fetch(dbUrl + "/pushSubscriptions/" + keyFor(subscription.endpoint) + ".json?auth=" + secret, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST") {
      const { id } = body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      await fetch(dbUrl + "/quoteLeads/" + id + ".json?auth=" + secret, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const endpoint = body?.endpoint;
      if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
      await fetch(dbUrl + "/pushSubscriptions/" + keyFor(endpoint) + ".json?auth=" + secret, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
