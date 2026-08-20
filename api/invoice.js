// Vercel serverless function backing InvoiceModal.jsx's "Square" invoice
// path. InvoiceModal fetches this route to get a Square access token +
// location id, then talks to Square's API directly from the browser.
//
// The token/location live in Vercel project env vars (Settings →
// Environment Variables), NOT in this file — never hardcode a real Square
// token here, since this file is committed to git.
//
//   SQUARE_ACCESS_TOKEN  — Personal Access Token from your Square
//                          Developer Dashboard (developer.squareup.com).
//                          Use a token whose permissions are scoped to
//                          just what invoicing needs — CUSTOMERS_READ,
//                          ORDERS_WRITE, INVOICES_WRITE — rather than a
//                          full-access token, since this route hands the
//                          token straight to the browser (see caveat
//                          below), so a narrower scope limits what
//                          someone with devtools access to your phone
//                          could do with it.
//   SQUARE_LOCATION_ID   — Your Square location id (Square Dashboard →
//                          Account & Settings → Locations, or via the
//                          Locations API).
//
// Caveat carried over from the existing InvoiceModal.jsx design: this
// route returns the token in the JSON response, and the browser then
// calls connect.squareup.com directly with it — so the token is visible
// to anyone with devtools open on the device running TechPortal while
// it's in use. Fine for a single-operator tool on your own phone; worth
// knowing if that ever changes.
module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const squareToken = process.env.SQUARE_ACCESS_TOKEN || "";
  const squareLocation = process.env.SQUARE_LOCATION_ID || "";

  if (!squareToken || !squareLocation) {
    res.status(200).json({
      squareToken: "",
      squareLocation: "",
      configured: false,
      error: "SQUARE_ACCESS_TOKEN and/or SQUARE_LOCATION_ID not set in Vercel env vars.",
    });
    return;
  }

  res.status(200).json({ squareToken, squareLocation, configured: true });
};
