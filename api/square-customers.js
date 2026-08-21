// Vercel serverless function — proxies Square's Customer search so the
// browser never talks to connect.squareup.com (or holds a Square token)
// directly.
//
// This replaces the old design where api/invoice.js handed the raw
// SQUARE_ACCESS_TOKEN to the browser and InvoiceModal.jsx called Square
// straight from the client. That never actually worked: Square's Connect
// REST API doesn't send CORS headers for browser origins, so the fetch
// was blocked before Square ever saw it — no matter how correct the
// token or SQUARE_LOCATION_ID were, every search failed with "Could not
// search Square customers." Proxying server-to-server here has no CORS
// issue (this function calls Square directly from Vercel's servers, not
// from a browser) and, as a bonus, the token itself never reaches the
// browser at all anymore.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    res.status(200).json({ customers: [], error: "SQUARE_ACCESS_TOKEN not set in Vercel env vars." });
    return;
  }

  const q = (req.query.q || "").toString().trim().toLowerCase();

  try {
    const sqRes = await fetch("https://connect.squareup.com/v2/customers?limit=100", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await sqRes.json();
    if (!sqRes.ok) {
      res.status(200).json({ customers: [], error: (data.errors && data.errors[0] && data.errors[0].detail) || "Square API error." });
      return;
    }

    const all = data.customers || [];
    const filtered = q
      ? all.filter((c) => ((c.given_name || "") + " " + (c.family_name || "") + " " + (c.company_name || "")).toLowerCase().includes(q))
      : all;

    // Only pass through what the UI actually needs — no reason to ship a
    // customer's full Square record (address, card-on-file refs, etc.) to
    // the browser just to render a name + email in a search result.
    const safe = filtered.slice(0, 20).map((c) => ({
      id: c.id,
      given_name: c.given_name || "",
      family_name: c.family_name || "",
      company_name: c.company_name || "",
      email_address: c.email_address || "",
    }));

    res.status(200).json({ customers: safe });
  } catch (e) {
    res.status(200).json({ customers: [], error: e.message });
  }
};
