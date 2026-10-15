// Stores/removes the browser's Web Push subscription (created client-side by
// QuoteGenerator.jsx via the Notifications button) in Firebase RTDB, so
// api/_push.js can push to every subscribed device whenever api/quote-lead.js
// receives a new website lead. Same "browser never touches the Firebase
// secret directly" pattern as api/quote-leads.js — this is the only place
// that writes to /pushSubscriptions.
//
// POST { subscription } -> { ok: true }     save/overwrite this device's subscription
// DELETE { endpoint }    -> { ok: true }     remove it (e.g. user tapped "Turn off")
const { keyFor } = require("./_push");

module.exports = async (req, res) => {
  const dbUrl = process.env.VITE_FIREBASE_DB_URL;
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!dbUrl || !secret) {
    return res.status(500).json({ error: "VITE_FIREBASE_DB_URL and/or FIREBASE_DB_SECRET not set in Vercel env vars." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  try {
    if (req.method === "POST") {
      const subscription = body?.subscription;
      if (!subscription?.endpoint) return res.status(400).json({ error: "Missing subscription" });
      await fetch(dbUrl + "/pushSubscriptions/" + keyFor(subscription.endpoint) + ".json?auth=" + secret, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
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
};
