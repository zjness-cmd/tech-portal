// DEPRECATED — this used to hand the raw SQUARE_ACCESS_TOKEN to the
// browser so InvoiceModal.jsx could call connect.squareup.com directly.
// Two problems with that: (1) it never actually worked — Square's Connect
// REST API doesn't send CORS headers for browser origins, so every
// customer search failed with "Could not search Square customers." no
// matter how correct the token/location were, and (2) this route had no
// auth check at all, so anyone who requested it — not just TechPortal
// itself — got the full-access production Square token back in the
// response. Replaced by api/square-customers.js and
// api/square-send-invoice.js, which keep the token server-side and do the
// actual Square calls from Vercel's servers instead of the browser.
//
// Left in place (rather than deleted) so this URL doesn't start 404ing if
// anything is still pointed at it — it never returns real credentials.
module.exports = (req, res) => {
  res.status(410).json({ error: "Deprecated — use /api/square-customers and /api/square-send-invoice instead." });
};
