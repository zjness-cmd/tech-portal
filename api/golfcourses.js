// Server-side proxy for OpenGolfAPI (https://opengolfapi.org) — a free,
// no-signup-required golf course database (32,000+ courses worldwide,
// 1,000 requests/day/IP anonymous) used to search for a course by name and
// pull its real hole-by-hole pars into the scorecard instead of typing
// them in by hand. Proxied through our own function rather than called
// directly from the browser to avoid relying on their CORS policy and to
// keep a single place to add a GOLF_API_KEY (raises the 1k/day anonymous
// cap to 10k-1M/day) if this ever gets used heavily enough to need one —
// none is required today.
//
// NOTE: the exact response field names below were assembled from
// OpenGolfAPI's published endpoint docs, not a live response — this repo's
// sandbox can't reach api.opengolfapi.org to confirm the JSON shape.
// parseHolesResponse() on the client side is deliberately defensive about
// field-name variants for exactly that reason; if course results load but
// pars come back as a flat default, the raw payload is logged to the
// console so the actual shape can be read off and the parser adjusted.

const BASE = "https://api.opengolfapi.org";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { action, q, state, id } = req.query;

  const headers = {};
  if (process.env.GOLF_API_KEY) headers.Authorization = "Bearer " + process.env.GOLF_API_KEY;

  try {
    if (action === "search") {
      if (!q || q.trim().length < 2) return res.status(400).json({ error: "Query too short" });
      const params = new URLSearchParams({ q: q.trim(), limit: "15" });
      if (state) params.set("state", state.trim().toUpperCase());
      const r = await fetch(BASE + "/v1/courses/search?" + params.toString(), { headers });
      if (!r.ok) return res.status(r.status).json({ error: "Search failed (" + r.status + ")" });
      return res.status(200).json(await r.json());
    }

    if (action === "detail") {
      if (!id) return res.status(400).json({ error: "Missing course id" });
      const [courseRes, holesRes] = await Promise.all([
        fetch(BASE + "/v1/courses/" + encodeURIComponent(id), { headers }),
        fetch(BASE + "/v1/courses/" + encodeURIComponent(id) + "/holes", { headers }),
      ]);
      const course = courseRes.ok ? await courseRes.json() : null;
      const holes = holesRes.ok ? await holesRes.json() : null;
      if (!course && !holes) return res.status(502).json({ error: "Could not load course details" });
      return res.status(200).json({ course, holes });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
