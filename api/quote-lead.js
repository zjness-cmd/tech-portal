// Public-facing endpoint — receives a lead from the tapbeercleaning.com
// contact/quote form (a DIFFERENT site/origin than this app), computes the
// same quote the in-app Quote Generator would, and emails it to the shop
// owner so they can follow up. Unlike every other api/*.js file in this
// project, this one is called by an anonymous website visitor, not by an
// already-authenticated TechPortal session — so it needs CORS handling and
// basic abuse resistance that the rest of api/ doesn't.
//
// Expected POST body (JSON) from the website form:
//   { name, email, phone, address, taps, website }
// - name, address, taps: required. taps must be a positive integer.
// - email and/or phone: at least one required (so there's a way to follow up).
// - website: honeypot field. Real visitors never fill it (it's hidden via
//   CSS on the form) — bots that blindly fill every field do. If present,
//   we return 200 (so the bot doesn't learn to try harder) but skip the
//   geocode/email work entirely.

// Only these origins get CORS headers back — otherwise a browser blocks the
// site's JS from reading the response. This does NOT stop a non-browser
// script from POSTing here directly (CORS never does), so it's paired with
// the honeypot above, not a substitute for it.
const ALLOWED_ORIGINS = [
  "https://tapbeercleaning.com",
  "https://www.tapbeercleaning.com",
  "http://localhost:3000",
  "http://localhost:8000",
];

// --- Pricing rules — intentionally duplicated from QuoteGenerator.jsx ---
// QuoteGenerator.jsx is a browser ES module; this file runs as a Vercel
// serverless function and can't import it directly. If the pricing rules
// change, update both files.
//   1-10 taps  -> $15.00/tap
//   11-20 taps -> $12.50/tap
//   21+ taps   -> $10.00/tap (floor)
//   Tap subtotal has a $75 minimum (travel fee is added on top of that).
//   Travel: $10 per 10 miles of ROUND-TRIP driving distance from HOME_ZIP,
//   rounded up.
const HOME_ZIP = "55362";
const MIN_SERVICE_CHARGE = 75;

function tapRate(taps) {
  if (taps <= 10) return 15;
  if (taps <= 20) return 12.5;
  return 10;
}

function travelFee(oneWayMiles) {
  return Math.ceil((oneWayMiles * 2) / 10) * 10;
}

function calcMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmt(n) {
  return "$" + n.toFixed(2);
}

async function geocode(address, apiKey) {
  const url = "https://maps.googleapis.com/maps/api/geocode/json?" + new URLSearchParams({ address, key: apiKey });
  const r = await fetch(url);
  const data = await r.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    throw new Error(data.status === "ZERO_RESULTS" ? "Couldn't find that address" : "Geocoding failed (" + data.status + ")");
  }
  return {
    lat: data.results[0].geometry.location.lat,
    lng: data.results[0].geometry.location.lng,
    formatted: data.results[0].formatted_address,
  };
}

// Real driving miles when the key allows Distance Matrix calls; falls back
// to straight-line if not (same fallback the in-app calculator uses when
// the Distance Matrix API is unavailable).
async function getDrivingMiles(home, dest, apiKey) {
  const straightLine = Math.round(calcMiles(home.lat, home.lng, dest.lat, dest.lng) * 10) / 10;
  try {
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json?" + new URLSearchParams({
      origins: home.lat + "," + home.lng,
      destinations: dest.lat + "," + dest.lng,
      units: "imperial",
      key: apiKey,
    });
    const r = await fetch(url);
    const data = await r.json();
    const el = data?.rows?.[0]?.elements?.[0];
    if (data.status === "OK" && el?.status === "OK") {
      return { miles: Math.round((el.distance.value / 1609.344) * 10) / 10, estimated: false };
    }
  } catch {}
  return { miles: straightLine, estimated: true };
}

async function sendLeadEmail({ apiKey, to, from, lead, quote }) {
  const contactLine = [lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact info given";
  const subject = "New quote request — " + lead.name + " (" + quote.taps + " taps, " + fmt(quote.total) + ")";
  const tapLine = quote.minimumApplied
    ? "Minimum service charge = " + fmt(quote.tapSubtotal)
    : quote.taps + " taps @ " + fmt(quote.rate) + "/tap = " + fmt(quote.tapSubtotal);
  const html = `
    <h2>New quote request from the website</h2>
    <p><strong>${escapeHtml(lead.name)}</strong><br>${escapeHtml(contactLine)}<br>${escapeHtml(quote.matchedAddress)}</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td>${escapeHtml(tapLine)}</td></tr>
      <tr><td>Travel (${quote.roundTripMiles} mi round trip${quote.estimatedDistance ? ", estimated" : ""}) = ${fmt(quote.travel)}</td></tr>
      <tr><td><strong>Total: ${fmt(quote.total)}</strong></td></tr>
    </table>
    ${lead.notes ? `<p><strong>Notes:</strong> ${escapeHtml(lead.notes)}</p>` : ""}
  `;
  const text = lead.name + "\n" + contactLine + "\n" + quote.matchedAddress + "\n\n" +
    tapLine + "\n" +
    "Travel (" + quote.roundTripMiles + " mi round trip" + (quote.estimatedDistance ? ", estimated" : "") + ") = " + fmt(quote.travel) + "\n" +
    "Total: " + fmt(quote.total) +
    (lead.notes ? "\n\nNotes: " + lead.notes : "");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Resend send failed");
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { name, email, phone, address, notes, website } = body || {};
  const taps = parseInt(body?.taps);

  // Honeypot tripped — pretend success, do nothing.
  if (website) return res.status(200).json({ ok: true });

  if (!name || !address) return res.status(400).json({ error: "Missing name or address" });
  if (!taps || taps < 1) return res.status(400).json({ error: "Missing or invalid taps" });
  if (!email && !phone) return res.status(400).json({ error: "Provide an email or phone number" });

  const geocodeKey = process.env.GOOGLE_GEOCODE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.QUOTE_LEAD_EMAIL_TO;
  if (!geocodeKey) return res.status(500).json({ error: "GOOGLE_GEOCODE_KEY not set in Vercel env vars." });
  if (!resendKey || !toEmail) return res.status(500).json({ error: "RESEND_API_KEY and/or QUOTE_LEAD_EMAIL_TO not set in Vercel env vars." });

  try {
    const [home, dest] = await Promise.all([geocode(HOME_ZIP, geocodeKey), geocode(address, geocodeKey)]);
    const { miles, estimated } = await getDrivingMiles(home, dest, geocodeKey);
    const roundTripMiles = Math.round(miles * 2 * 10) / 10;
    const rate = tapRate(taps);
    const rawTapSubtotal = Math.round(taps * rate * 100) / 100;
    const minimumApplied = rawTapSubtotal < MIN_SERVICE_CHARGE;
    const tapSubtotal = minimumApplied ? MIN_SERVICE_CHARGE : rawTapSubtotal;
    const travel = travelFee(miles);
    const total = Math.round((tapSubtotal + travel) * 100) / 100;
    const quote = { taps, rate, tapSubtotal, minimumApplied, miles, roundTripMiles, estimatedDistance: estimated, travel, total, matchedAddress: dest.formatted };

    await sendLeadEmail({
      apiKey: resendKey,
      to: toEmail,
      from: process.env.QUOTE_LEAD_EMAIL_FROM || "TechPortal Quotes <onboarding@resend.dev>",
      lead: { name, email, phone, notes },
      quote,
    });

    res.status(200).json({ ok: true, quote });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
