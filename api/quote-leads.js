// Serves/manages website quote-request leads that api/quote-lead.js writes
// to Firebase Realtime Database, so QuoteGenerator.jsx (running in the
// tech's own browser) can show them without the browser itself needing the
// Firebase database secret. The /quoteLeads path is locked down in
// Firebase's security rules (no public read/write, unlike /golfRooms) —
// only this file and api/quote-lead.js hold FIREBASE_DB_SECRET and can
// touch it, via Firebase's legacy REST `?auth=<secret>` param.
//
// GET  -> { leads: [...] }               list all pending leads, newest first
// POST { id } -> { ok: true }            dismiss (delete) one lead by its Firebase key
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

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const { id } = body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      await fetch(dbUrl + "/quoteLeads/" + id + ".json?auth=" + secret, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
