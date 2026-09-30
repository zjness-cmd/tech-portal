import React, { useState } from "react";
import { getDrivingMiles } from "../mapsUtils";

// The business's own zip — every quote's travel fee is driving distance
// from here. Geocoded once and cached (HOME_COORDS_KEY below) rather than
// re-geocoded on every quote, since it never changes.
const HOME_ZIP = "55362";
const HOME_COORDS_KEY = "techportal_quoteHomeCoords";

// Pricing rules (confirmed with the user, not guessed):
// - Travel: $5 per 10 miles of driving distance from HOME_ZIP, rounded UP
//   to the next full 10-mile increment (e.g. 24 mi -> 3 increments -> $15).
// - Taps: flat-tier, not graduated — whichever band the total tap count
//   falls into sets the rate for ALL of their taps, not just the taps
//   past the previous threshold.
//     1-10 taps  -> $15.00/tap
//     11-20 taps -> $12.50/tap
//     21+ taps   -> $10.00/tap (floor — stays here past 30, doesn't keep dropping)
function tapRate(taps) {
  if (taps <= 10) return 15;
  if (taps <= 20) return 12.5;
  return 10;
}

function travelFee(miles) {
  return Math.ceil(miles / 10) * 5;
}

const QUOTES_KEY = "techportal_savedQuotes";
function loadJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function fmt(n) {
  return "$" + n.toFixed(2);
}

// Prefers the native share sheet, falls back to opening Messages directly
// — same pattern used for texting scorecards/invoices elsewhere in the app.
function shareQuote(text) {
  if (navigator.share) {
    navigator.share({ title: "Quote", text }).catch(() => {});
    return;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  window.location.href = "sms:" + (isIOS ? "&" : "?") + "body=" + encodeURIComponent(text);
}

export default function QuoteGenerator({ onClose }) {
  const [customerName, setCustomerName] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [taps, setTaps] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { miles, matchedAddress, ... }
  const [savedQuotes, setSavedQuotes] = useState(() => loadJSON(QUOTES_KEY, []));
  const [showSaved, setShowSaved] = useState(false);

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
      const rate = tapRate(tapCount);
      const tapSubtotal = Math.round(tapCount * rate * 100) / 100;
      const travel = travelFee(miles);
      const total = Math.round((tapSubtotal + travel) * 100) / 100;
      setResult({ miles, matchedAddress: dest.formatted, taps: tapCount, rate, tapSubtotal, travel, total });
    } catch (e) {
      setError(e.message || "Could not calculate quote");
    }
    setLoading(false);
  };

  const quoteText = () => {
    if (!result) return "";
    const lines = [];
    lines.push("⛳ Beer Line Cleaning Quote" + (customerName.trim() ? " — " + customerName.trim() : ""));
    lines.push(result.taps + " taps @ " + fmt(result.rate) + "/tap = " + fmt(result.tapSubtotal));
    lines.push("Travel (" + result.miles + " mi) = " + fmt(result.travel));
    lines.push("Total: " + fmt(result.total));
    return lines.join("\n");
  };

  const saveQuote = () => {
    if (!result) return;
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      customerName: customerName.trim() || "Unnamed",
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
        React.createElement("div", { style: styles.fieldGroup },
          React.createElement("label", { style: styles.fieldLabel }, "Customer name (optional)"),
          React.createElement("input", { style: styles.input, type: "text", value: customerName, onChange: e => setCustomerName(e.target.value) })
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
            React.createElement("span", null, result.taps + " taps @ " + fmt(result.rate) + "/tap"),
            React.createElement("span", null, fmt(result.tapSubtotal))
          ),
          React.createElement("div", { style: styles.resultRow },
            React.createElement("span", null, "Travel — " + result.miles + " mi (" + HOME_ZIP + ")"),
            React.createElement("span", null, fmt(result.travel))
          ),
          React.createElement("div", { style: { ...styles.resultRow, ...styles.resultTotal } },
            React.createElement("span", null, "Total"),
            React.createElement("span", null, fmt(result.total))
          ),
          React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } },
            React.createElement("button", { style: { ...styles.btnSecondary, flex: 1 }, onClick: () => shareQuote(quoteText()) }, "📱 Text Quote"),
            React.createElement("button", { style: { ...styles.btnSecondary, flex: 1 }, onClick: saveQuote }, "💾 Save Quote")
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
              : savedQuotes.map(q => React.createElement("div", { key: q.id, style: styles.savedRow },
                  React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                    React.createElement("div", { style: styles.savedName }, q.customerName),
                    React.createElement("div", { style: styles.savedSub }, q.date + " · " + q.taps + " taps · " + q.miles + " mi · " + fmt(q.total))
                  ),
                  React.createElement("button", { style: styles.iconBtn, title: "Text this quote", onClick: () => shareQuote(
                    "⛳ Beer Line Cleaning Quote — " + q.customerName + "\n" +
                    q.taps + " taps @ " + fmt(q.rate) + "/tap = " + fmt(q.tapSubtotal) + "\n" +
                    "Travel (" + q.miles + " mi) = " + fmt(q.travel) + "\n" +
                    "Total: " + fmt(q.total)
                  ) }, "📱"),
                  React.createElement("button", { style: { ...styles.iconBtn, color: "#A32D2D" }, title: "Delete", onClick: () => deleteQuote(q.id) }, "🗑")
                ))
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
  btnPrimary: { padding: "12px", borderRadius: 10, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15 },
  btnSecondary: { padding: "10px", borderRadius: 8, background: "#f0f4ff", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 },
  resultBox: { background: "#f9f9f9", border: "0.5px solid #e0e0e0", borderRadius: 10, padding: "0.9rem 1rem" },
  resultAddress: { fontSize: 12, color: "#888", marginBottom: 8 },
  resultRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#444", padding: "4px 0" },
  resultTotal: { fontWeight: 700, fontSize: 16, color: "#1a1a1a", borderTop: "0.5px solid #e0e0e0", marginTop: 6, paddingTop: 8 },
  sectionToggle: { background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#888", padding: 0, marginBottom: 8 },
  empty: { fontSize: 13, color: "#888", fontStyle: "italic" },
  savedRow: { display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0", borderBottom: "0.5px solid #f0f0f0" },
  savedName: { fontSize: 13, fontWeight: 600, color: "#1a1a1a" },
  savedSub: { fontSize: 11, color: "#888", marginTop: 2 },
  iconBtn: { fontSize: 15, background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "#185FA5" },
};
