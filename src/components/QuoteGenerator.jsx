import React, { useState, useEffect } from "react";
import { getDrivingMiles } from "../mapsUtils";

// The business's own zip — every quote's travel fee is driving distance
// from here. Geocoded once and cached (HOME_COORDS_KEY below) rather than
// re-geocoded on every quote, since it never changes.
const HOME_ZIP = "55362";
const HOME_COORDS_KEY = "techportal_quoteHomeCoords";

// Pricing rules (confirmed with the user, not guessed):
// - Travel: $10 per 10 miles of ROUND-TRIP driving distance from HOME_ZIP
//   (there and back — getDrivingMiles only gives one-way, so it's doubled
//   here), rounded UP to the next full 10-mile increment (e.g. 24 mi
//   one-way -> 48 mi round trip -> 5 increments -> $50).
// - Taps: flat-tier, not graduated — whichever band the total tap count
//   falls into sets the rate for ALL of their taps, not just the taps
//   past the previous threshold.
//     1-10 taps  -> $15.00/tap
//     11-20 taps -> $12.50/tap
//     21+ taps   -> $10.00/tap (floor — stays here past 30, doesn't keep dropping)
// - Minimum: the tap/service charge alone has a $75 floor (e.g. 3 taps @
//   $15 = $45 -> bumped to $75). Travel fee is a separate line added on
//   top of whichever is larger, not folded into the minimum.
function tapRate(taps) {
  if (taps <= 10) return 15;
  if (taps <= 20) return 12.5;
  return 10;
}

const MIN_SERVICE_CHARGE = 75;

function travelFee(oneWayMiles) {
  return Math.ceil((oneWayMiles * 2) / 10) * 10;
}

const QUOTES_KEY = "techportal_savedQuotes";
function loadJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function fmt(n) {
  return "$" + n.toFixed(2);
}

// Shared by the on-screen result, the text-quote message, and saved-quote
// re-share — a quote hit by the $75 minimum shows "Minimum service charge"
// instead of the per-tap math, since "3 taps @ $15/tap = $75" would be
// misleading (that's not what $75 actually breaks down to).
function tapLineText(taps, rate, tapSubtotal, minimumApplied) {
  if (minimumApplied) return "Minimum service charge = " + fmt(tapSubtotal);
  return taps + " taps @ " + fmt(rate) + "/tap = " + fmt(tapSubtotal);
}

const BUSINESS_PHONE = "612-293-9459";
const BOOKING_URL = "https://calendar.app.google/mJrbNarX5ptwfCE17";
const REPLY_SUBJECT = "Your beer line cleaning quote — Ness Draft Beer Service";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// Customer-facing reply for a quote — pre-filled into the editable message
// box, then sent by text or email. Greets by first name when there is one.
function buildReply({ name, taps, rate, tapSubtotal, minimumApplied, roundTripMiles, travel, total }) {
  const first = (name || "").trim().split(/\s+/)[0];
  return [
    (first ? "Hi " + first + "," : "Hi,") + " thanks for reaching out to Ness Draft Beer Service! Here's your quote for beer line cleaning (" + taps + " taps):",
    "",
    tapLineText(taps, rate, tapSubtotal, minimumApplied),
    "Travel (" + roundTripMiles + " mi round trip) = " + fmt(travel),
    "Total: " + fmt(total),
    "",
    "Want to get on the schedule? Just reply here, call/text " + BUSINESS_PHONE + ", or book online: " + BOOKING_URL,
    "",
    "– Zach, Ness Draft Beer Service",
  ].join("\n");
}

// With a phone number, opens Messages addressed to that customer (the share
// sheet can't pre-fill a recipient). Without one, prefers the native share
// sheet, falling back to a blank-recipient Messages — same pattern used for
// texting scorecards/invoices elsewhere in the app.
function shareQuote(text, phone) {
  const sep = isIOS() ? "&" : "?";
  const to = (phone || "").replace(/[^\d+]/g, "");
  if (to) {
    window.location.href = "sms:" + to + sep + "body=" + encodeURIComponent(text);
    return;
  }
  if (navigator.share) {
    navigator.share({ title: "Quote", text }).catch(() => {});
    return;
  }
  window.location.href = "sms:" + sep + "body=" + encodeURIComponent(text);
}

// Base64url of a UTF-8 string (Gmail API "raw" format, and RFC 2047 headers).
function b64utf8(str, url) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return url ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64;
}

// Sends straight from the signed-in Gmail account via the Gmail API (no
// mail app). Needs the gmail.send scope — a 401/403 here almost always
// means this session signed in before that scope was added.
async function sendQuoteEmail(accessToken, to, text) {
  const mime = [
    "To: " + to,
    "Subject: =?UTF-8?B?" + b64utf8(REPLY_SUBJECT) + "?=",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64utf8(text).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64utf8(mime, true) }),
  });
  if (r.status === 401 || r.status === 403) {
    const err = new Error("needs-permission");
    err.detail = (await r.json().catch(() => ({})))?.error?.message || "";
    throw err;
  }
  if (!r.ok) throw new Error("Gmail send failed (" + r.status + ")");
}

// Fallback: opens the device's default mail app with the customer, subject
// and body filled in — sends from whichever account that app is set to.
function emailQuote(text, email) {
  window.location.href = "mailto:" + encodeURIComponent((email || "").trim()) +
    "?subject=" + encodeURIComponent(REPLY_SUBJECT) +
    "&body=" + encodeURIComponent(text);
}

export default function QuoteGenerator({ accessToken, onClose }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Editable customer reply; regenerated whenever the quote or name changes.
  const [replyMsg, setReplyMsg] = useState("");
  // "" | "sending" | "sent" | "needs-permission" | "error:<message>"
  const [emailStatus, setEmailStatus] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [taps, setTaps] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { miles, matchedAddress, ... }
  const [savedQuotes, setSavedQuotes] = useState(() => loadJSON(QUOTES_KEY, []));
  const [showSaved, setShowSaved] = useState(false);
  // Leads from the tapbeercleaning.com website's quote form — pushed by
  // api/quote-lead.js into Firebase, fetched here via api/quote-leads.js
  // (the browser never touches Firebase directly / never sees the DB
  // secret for this path, unlike GolfScorecard's open golfRooms).
  const [websiteLeads, setWebsiteLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [showLeads, setShowLeads] = useState(true);

  const loadLeads = () => {
    setLoadingLeads(true);
    fetch("/api/quote-leads")
      .then(r => r.json())
      .then(d => setWebsiteLeads(d.leads || []))
      .catch(() => {})
      .finally(() => setLoadingLeads(false));
  };

  useEffect(() => { loadLeads(); }, []);

  useEffect(() => {
    setReplyMsg(result ? buildReply({ ...result, name: customerName }) : "");
    setEmailStatus("");
  }, [result, customerName]);

  const sendEmail = async () => {
    const to = customerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setEmailStatus("error:Add the customer's email address first."); return; }
    // Sends immediately (no mail app to review in), so confirm first.
    if (!window.confirm("Send this quote to " + to + " from your Gmail?")) return;
    setEmailStatus("sending");
    try {
      await sendQuoteEmail(accessToken, to, replyMsg);
      setEmailStatus("sent");
    } catch (e) {
      setEmailStatus(e.message === "needs-permission" ? "needs-permission" : "error:" + (e.message || "Couldn't send"));
    }
  };

  const useLead = (lead) => {
    setCustomerName(lead.name || "");
    setCustomerEmail(lead.email || "");
    setCustomerPhone(lead.phone || "");
    setAddressInput(lead.quote.matchedAddress || "");
    setTaps(String(lead.quote.taps));
    setResult(lead.quote);
    setError("");
  };

  const dismissLead = (id) => {
    setWebsiteLeads(prev => prev.filter(l => l.id !== id));
    fetch("/api/quote-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  };

  const geocode = async (address) => {
    const r = await fetch("/api/geocode?" + new URLSearchParams({ address }));
    const data = await r.json();
    if (data.status !== "OK" || !data.results?.[0]) {
      throw new Error(data.status === "ZERO_RESULTS" ? "Couldn't find that address" : "Geocoding failed (" + data.status + ")");
    }
    return {
      lat: data.results[0].geometry.location.lat,
      lng: data.results[0].geometry.location.lng,
      formatted: data.results[0].formatted_address,
    };
  };

  const getHomeCoords = async () => {
    const cached = loadJSON(HOME_COORDS_KEY, null);
    if (cached) return cached;
    const coords = await geocode(HOME_ZIP);
    try { localStorage.setItem(HOME_COORDS_KEY, JSON.stringify(coords)); } catch {}
    return coords;
  };

  const calculate = async () => {
    const tapCount = parseInt(taps);
    if (!addressInput.trim()) { setError("Enter the customer's address or zip"); return; }
    if (!tapCount || tapCount < 1) { setError("Enter how many taps"); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const [home, dest] = await Promise.all([getHomeCoords(), geocode(addressInput.trim())]);
      const miles = await getDrivingMiles(home.lat, home.lng, dest.lat, dest.lng);
      const roundTripMiles = Math.round(miles * 2 * 10) / 10;
      const rate = tapRate(tapCount);
      const rawTapSubtotal = Math.round(tapCount * rate * 100) / 100;
      const minimumApplied = rawTapSubtotal < MIN_SERVICE_CHARGE;
      const tapSubtotal = minimumApplied ? MIN_SERVICE_CHARGE : rawTapSubtotal;
      const travel = travelFee(miles);
      const total = Math.round((tapSubtotal + travel) * 100) / 100;
      setResult({ miles, roundTripMiles, matchedAddress: dest.formatted, taps: tapCount, rate, tapSubtotal, minimumApplied, travel, total });
    } catch (e) {
      setError(e.message || "Could not calculate quote");
    }
    setLoading(false);
  };

  const saveQuote = () => {
    if (!result) return;
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      customerName: customerName.trim() || "Unnamed",
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
      address: result.matchedAddress,
      ...result,
    };
    const next = [entry, ...savedQuotes];
    setSavedQuotes(next);
    try { localStorage.setItem(QUOTES_KEY, JSON.stringify(next)); } catch {}
  };

  const deleteQuote = (id) => {
    const next = savedQuotes.filter(q => q.id !== id);
    setSavedQuotes(next);
    try { localStorage.setItem(QUOTES_KEY, JSON.stringify(next)); } catch {}
  };

  return React.createElement("div", { style: styles.overlay, onClick: onClose },
    React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },

      // Header
      React.createElement("div", { style: styles.header },
        React.createElement("div", { style: styles.headerTitle }, "🧮 Quote Generator"),
        React.createElement("button", { onClick: onClose, style: styles.closeBtn }, "×")
      ),

      React.createElement("div", { style: styles.body },

        // Website leads — incoming requests from the tapbeercleaning.com quote form
        React.createElement("div", { style: { marginBottom: 20 } },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
            React.createElement("button", {
              style: styles.sectionToggle, onClick: () => setShowLeads(!showLeads),
            }, (showLeads ? "▾" : "▸") + " Website Leads (" + websiteLeads.length + ")"),
            React.createElement("button", { style: styles.refreshBtn, onClick: loadLeads, title: "Check for new leads" }, "↻")
          ),
          showLeads && (
            loadingLeads
              ? React.createElement("div", { style: styles.empty }, "Checking for leads...")
              : websiteLeads.length === 0
                ? React.createElement("div", { style: styles.empty }, "No new leads from the website.")
                : websiteLeads.map(lead => React.createElement("div", { key: lead.id, style: styles.savedRow },
                    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                      React.createElement("div", { style: styles.savedName }, lead.name),
                      React.createElement("div", { style: styles.savedSub }, [lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact info"),
                      React.createElement("div", { style: styles.savedSub }, lead.quote.taps + " taps · " + lead.quote.matchedAddress + " · " + fmt(lead.quote.total)),
                      lead.notes && React.createElement("div", { style: styles.savedSub }, lead.notes)
                    ),
                    React.createElement("button", { style: styles.iconBtn, title: "Use this lead", onClick: () => useLead(lead) }, "➡️"),
                    React.createElement("button", { style: { ...styles.iconBtn, color: "#A32D2D" }, title: "Dismiss", onClick: () => dismissLead(lead.id) }, "🗑")
                  ))
          )
        ),

        React.createElement("div", { style: styles.fieldGroup },
          React.createElement("label", { style: styles.fieldLabel }, "Customer name (optional)"),
          React.createElement("input", { style: styles.input, type: "text", value: customerName, onChange: e => setCustomerName(e.target.value) })
        ),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement("div", { style: { ...styles.fieldGroup, flex: 1, minWidth: 0 } },
            React.createElement("label", { style: styles.fieldLabel }, "Email (optional)"),
            React.createElement("input", { style: styles.input, type: "email", value: customerEmail, onChange: e => setCustomerEmail(e.target.value) })
          ),
          React.createElement("div", { style: { ...styles.fieldGroup, flex: 1, minWidth: 0 } },
            React.createElement("label", { style: styles.fieldLabel }, "Phone (optional)"),
            React.createElement("input", { style: styles.input, type: "tel", value: customerPhone, onChange: e => setCustomerPhone(e.target.value) })
          )
        ),
        React.createElement("div", { style: styles.fieldGroup },
          React.createElement("label", { style: styles.fieldLabel }, "Customer address or zip"),
          React.createElement("input", {
            style: styles.input, type: "text", placeholder: "e.g. 123 Main St, Buffalo, MN or 55313",
            value: addressInput, onChange: e => setAddressInput(e.target.value),
            onKeyDown: e => { if (e.key === "Enter") calculate(); },
          })
        ),
        React.createElement("div", { style: styles.fieldGroup },
          React.createElement("label", { style: styles.fieldLabel }, "Number of taps"),
          React.createElement("input", {
            style: styles.input, type: "number", min: 1, value: taps,
            onChange: e => setTaps(e.target.value),
            onKeyDown: e => { if (e.key === "Enter") calculate(); },
          })
        ),
        error && React.createElement("div", { style: styles.errorBox }, error),
        React.createElement("button", {
          style: { ...styles.btnPrimary, width: "100%", marginBottom: 12 },
          disabled: loading, onClick: calculate,
        }, loading ? "Calculating..." : "Calculate Quote"),

        result && React.createElement("div", { style: styles.resultBox },
          React.createElement("div", { style: styles.resultAddress }, "📍 " + result.matchedAddress),
          React.createElement("div", { style: styles.resultRow },
            React.createElement("span", null, result.minimumApplied ? "Minimum service charge (" + result.taps + " taps)" : result.taps + " taps @ " + fmt(result.rate) + "/tap"),
            React.createElement("span", null, fmt(result.tapSubtotal))
          ),
          React.createElement("div", { style: styles.resultRow },
            React.createElement("span", null, "Travel — " + result.roundTripMiles + " mi round trip (" + HOME_ZIP + ")"),
            React.createElement("span", null, fmt(result.travel))
          ),
          React.createElement("div", { style: { ...styles.resultRow, ...styles.resultTotal } },
            React.createElement("span", null, "Total"),
            React.createElement("span", null, fmt(result.total))
          ),
          React.createElement("label", { style: { ...styles.fieldLabel, marginTop: 12 } }, "Reply to customer (edit before sending)"),
          React.createElement("textarea", {
            style: styles.replyBox, rows: 9, value: replyMsg,
            onChange: e => setReplyMsg(e.target.value),
          }),
          React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
            React.createElement("button", {
              style: { ...styles.btnSecondary, flex: 1 }, onClick: () => shareQuote(replyMsg, customerPhone),
              title: customerPhone ? "Text " + customerPhone : "No phone — opens Messages without a recipient",
            }, "📱 Text"),
            React.createElement("button", {
              style: { ...styles.btnSecondary, flex: 1, opacity: emailStatus === "sending" ? 0.6 : 1 },
              disabled: emailStatus === "sending", onClick: sendEmail,
              title: customerEmail ? "Send to " + customerEmail + " from your Gmail" : "Add the customer's email first",
            }, emailStatus === "sending" ? "Sending…" : emailStatus === "sent" ? "✅ Sent" : "✉️ Email"),
            React.createElement("button", { style: { ...styles.btnSecondary, flex: 1 }, onClick: saveQuote }, "💾 Save")
          ),
          emailStatus === "sent" && React.createElement("div", { style: styles.okBox }, "Sent to " + customerEmail.trim() + " — it's in your Gmail Sent folder."),
          emailStatus === "needs-permission" && React.createElement("div", { style: styles.errorBox },
            "TechPortal needs permission to send email. Sign out of TechPortal and sign back in, and approve sending email. ",
            React.createElement("button", { style: styles.linkBtn, onClick: () => emailQuote(replyMsg, customerEmail) }, "Open in mail app instead")
          ),
          emailStatus.startsWith("error:") && React.createElement("div", { style: styles.errorBox },
            emailStatus.slice(6) + " ",
            React.createElement("button", { style: styles.linkBtn, onClick: () => emailQuote(replyMsg, customerEmail) }, "Open in mail app instead")
          )
        ),

        // Saved quotes
        React.createElement("div", { style: { marginTop: 20 } },
          React.createElement("button", {
            style: styles.sectionToggle, onClick: () => setShowSaved(!showSaved),
          }, (showSaved ? "▾" : "▸") + " Saved Quotes (" + savedQuotes.length + ")"),
          showSaved && (
            savedQuotes.length === 0
              ? React.createElement("div", { style: styles.empty }, "No saved quotes yet.")
              : savedQuotes.map(q => {
                  // Older saved quotes predate roundTripMiles (they stored
                  // one-way miles) — fall back to doubling so old entries
                  // still display sensibly instead of showing "undefined".
                  const rtMiles = q.roundTripMiles != null ? q.roundTripMiles : Math.round(q.miles * 2 * 10) / 10;
                  return React.createElement("div", { key: q.id, style: styles.savedRow },
                  React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                    React.createElement("div", { style: styles.savedName }, q.customerName),
                    React.createElement("div", { style: styles.savedSub }, q.date + " · " + q.taps + " taps · " + rtMiles + " mi RT · " + fmt(q.total))
                  ),
                  React.createElement("button", { style: styles.iconBtn, title: "Text this quote", onClick: () => shareQuote(
                    buildReply({ ...q, roundTripMiles: rtMiles, name: q.customerName === "Unnamed" ? "" : q.customerName }),
                    q.customerPhone
                  ) }, "📱"),
                  React.createElement("button", { style: { ...styles.iconBtn, color: "#A32D2D" }, title: "Delete", onClick: () => deleteQuote(q.id) }, "🗑")
                  );
                })
          )
        )
      )
    )
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  headerTitle: { fontSize: 17, fontWeight: 700, color: "#1a1a1a" },
  closeBtn: { fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#888", lineHeight: 1 },
  body: { overflowY: "auto", flex: 1, padding: "1rem 1.25rem" },
  fieldGroup: { marginBottom: "0.75rem" },
  fieldLabel: { fontSize: 12, color: "#888", display: "block", marginBottom: 4 },
  input: { width: "100%", padding: "9px 12px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 8, background: "#fff", color: "#1a1a1a", boxSizing: "border-box" },
  errorBox: { fontSize: 13, color: "#c0392b", background: "#fef0f0", padding: "8px 12px", borderRadius: 8, marginBottom: 10 },
  okBox: { fontSize: 13, color: "#1e7a46", background: "#eefaf2", padding: "8px 12px", borderRadius: 8, marginTop: 8 },
  linkBtn: { background: "none", border: "none", padding: 0, color: "#185FA5", textDecoration: "underline", cursor: "pointer", fontSize: 13 },
  btnPrimary: { padding: "12px", borderRadius: 10, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15 },
  btnSecondary: { padding: "10px", borderRadius: 8, background: "#f0f4ff", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 },
  replyBox: { width: "100%", padding: "9px 12px", fontSize: 13, lineHeight: 1.45, border: "0.5px solid #ccc", borderRadius: 8, background: "#fff", color: "#1a1a1a", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" },
  resultBox: { background: "#f9f9f9", border: "0.5px solid #e0e0e0", borderRadius: 10, padding: "0.9rem 1rem" },
  resultAddress: { fontSize: 12, color: "#888", marginBottom: 8 },
  resultRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#444", padding: "4px 0" },
  resultTotal: { fontWeight: 700, fontSize: 16, color: "#1a1a1a", borderTop: "0.5px solid #e0e0e0", marginTop: 6, paddingTop: 8 },
  sectionToggle: { background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#888", padding: 0, marginBottom: 8 },
  refreshBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#185FA5", padding: "2px 6px" },
  empty: { fontSize: 13, color: "#888", fontStyle: "italic" },
  savedRow: { display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0", borderBottom: "0.5px solid #f0f0f0" },
  savedName: { fontSize: 13, fontWeight: 600, color: "#1a1a1a" },
  savedSub: { fontSize: 11, color: "#888", marginTop: 2 },
  iconBtn: { fontSize: 15, background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "#185FA5" },
};
