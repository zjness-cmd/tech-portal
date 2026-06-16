import React, { useState } from "react";

const MAPS_API_KEY = import.meta.env.VITE_MAPS_API_KEY;

const STATUS_STYLES = {
  Scheduled:    { bg: "#E6F1FB", color: "#0C447C" },
  "In Progress":{ bg: "#FAEEDA", color: "#633806" },
  Done:         { bg: "#EAF3DE", color: "#27500A" },
  "Checked In": { bg: "#EAF3DE", color: "#27500A" },
  "Checked Out":{ bg: "#F0F4FF", color: "#185FA5" },
};

function stripHtml(str) {
  if (!str) return "";
  return str
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getStreetViewUrl(location) {
  if (!location || !MAPS_API_KEY) return null;
  return "https://maps.googleapis.com/maps/api/streetview?" + new URLSearchParams({
    location, size: "600x120", scale: "2", fov: "90", pitch: "0", key: MAPS_API_KEY,
  });
}

async function checkStreetViewExists(location) {
  if (!location || !MAPS_API_KEY) return false;
  try {
    const url = "https://maps.googleapis.com/maps/api/streetview/metadata?" + new URLSearchParams({ location, key: MAPS_API_KEY });
    const res = await fetch(url);
    const data = await res.json();
    return data.status === "OK";
  } catch { return false; }
}

export default function JobCard({
  job, location, status, checkedIn, checkedOut, completed, invoiceUrl,
  onCheckIn, onCheckOut, onComplete, onNavigate, onUndo, onInvoice, onMissed,
  isNearby,
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgChecked, setImgChecked] = useState(false);
  const [imgExists, setImgExists] = useState(false);
  const [showCompleteChoice, setShowCompleteChoice] = useState(false);

  React.useEffect(() => {
    if (!job.location || !MAPS_API_KEY) { setImgChecked(true); return; }
    checkStreetViewExists(job.location).then(exists => {
      setImgExists(exists);
      setImgChecked(true);
    });
  }, [job.location]);

  const badge = STATUS_STYLES[status] || STATUS_STYLES["Scheduled"];

  const rawDesc = (job.description || "")
    .replace(/\n?---TechPortal---[\s\S]*?---End TechPortal---/g, "")
    .trim();
  const cleanDesc = stripHtml(rawDesc);

  let navigateUrl = null;
  if (job.location) {
    navigateUrl = location
      ? `https://www.google.com/maps/dir/${location.lat},${location.lng}/${encodeURIComponent(job.location)}`
      : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`;
  }

  const streetViewUrl = getStreetViewUrl(job.location);
  const showImage = streetViewUrl && !imgFailed && imgChecked && imgExists;

  // Determine which button group to show
  const showMissed = !checkedIn && !completed && !!onMissed;
  const showCheckIn = !checkedIn && !completed;
  const showCheckOut = checkedIn && !checkedOut && !completed;
  const showComplete = checkedOut && !completed && !showCompleteChoice;
  const showCompleteChoice_ = checkedOut && !completed && showCompleteChoice;
  const showUndo = (checkedIn || checkedOut) && !completed;

  return (
    React.createElement("div", { style: s.card },

      // ── Header row ──────────────────────────────────────────────────────
      React.createElement("div", { style: s.cardTop },
        React.createElement("span", { style: s.time },
          job.startTime + (job.endTime ? " - " + job.endTime : "")
        ),
        React.createElement("span", { style: { ...s.badge, background: badge.bg, color: badge.color } }, status)
      ),

      // ── Title + location ────────────────────────────────────────────────
      React.createElement("div", { style: s.cardTitle }, job.title),
      job.location && React.createElement("div", { style: s.cardMeta }, "📍 " + job.location),

      // ── Street View image ────────────────────────────────────────────────
      showImage && React.createElement("a", {
        href: job.calendarLink || "#", target: "_blank", rel: "noreferrer",
        style: { display: "block", marginBottom: 8 },
      },
        React.createElement("img", {
          src: streetViewUrl,
          alt: "Street View",
          style: { width: "100%", height: 110, objectFit: "cover", borderRadius: 8, display: "block" },
          onError: () => setImgFailed(true),
        })
      ),

      // ── Description ─────────────────────────────────────────────────────
      cleanDesc.length > 0 && React.createElement("div", { style: s.cardDesc },
        cleanDesc.slice(0, 150) + (cleanDesc.length > 150 ? "…" : "")
      ),

      // ── Check-in / check-out times ──────────────────────────────────────
      (checkedIn || checkedOut) && React.createElement("div", { style: s.timesRow },
        checkedIn  && React.createElement("span", { style: s.timeChip }, "🟢 In: "  + checkedIn),
        checkedOut && React.createElement("span", { style: s.timeChip }, "🔴 Out: " + checkedOut)
      ),

      // ── Nearby banner ───────────────────────────────────────────────────
      isNearby && !checkedIn && !completed && React.createElement("div", {
        style: { fontSize: 12, color: "#27500A", background: "#EAF3DE", borderRadius: 6, padding: "5px 10px", marginBottom: 6, fontWeight: 500 }
      }, "📍 You're nearby — auto check-in in ~1 min"),

      // ── Action buttons ──────────────────────────────────────────────────
      React.createElement("div", { style: s.actionRow },

        // Navigate
        navigateUrl && !completed &&
          React.createElement("a", {
            href: navigateUrl, target: "_blank", rel: "noreferrer",
            style: s.navButton, onClick: onNavigate,
          }, "🗺️ Navigate"),

        // ⚠️ Missed — BEFORE Check in so it's not pushed off screen
        showMissed &&
          React.createElement("button", {
            style: s.missedBtn,
            onClick: onMissed,
          }, "⚠️ Missed"),

        // Check in
        showCheckIn &&
          React.createElement("button", { style: s.checkInBtn, onClick: onCheckIn }, "📍 Check in"),

        // Check out
        showCheckOut &&
          React.createElement("button", { style: s.checkOutBtn, onClick: onCheckOut }, "🚪 Check out"),

        // Mark complete
        showComplete &&
          React.createElement("button", { style: s.completeBtn, onClick: () => setShowCompleteChoice(true) }, "✅ Mark complete"),

        // Complete choice (Done / Missed)
        showCompleteChoice_ &&
          React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
            React.createElement("span", { style: { fontSize: 12, color: "#444", fontWeight: 500 } }, "How'd it go?"),
            React.createElement("button", { style: s.completeBtn, onClick: () => { setShowCompleteChoice(false); onComplete(); } }, "✅ Completed"),
            React.createElement("button", { style: { ...s.completeBtn, background: "#FEF3CD", color: "#856404" }, onClick: () => { setShowCompleteChoice(false); onMissed && onMissed(); } }, "⚠️ Missed"),
            React.createElement("button", { style: { ...s.undoBtn, fontSize: 11 }, onClick: () => setShowCompleteChoice(false) }, "Cancel")
          ),

        // Undo
        showUndo &&
          React.createElement("button", { style: s.undoBtn, onClick: onUndo }, "↩ Undo"),

        // Completed state
        completed && React.createElement("span", { style: s.checkedInLabel }, "✅ Completed"),
        completed && React.createElement("button", { style: s.undoBtn, onClick: onUndo }, "↩ Undo"),

        // Invoice
        invoiceUrl
          ? React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
              React.createElement("a", {
                href: invoiceUrl, target: "_blank", rel: "noreferrer", style: s.viewInvoiceBtn,
              }, "📄 View Invoice"),
              React.createElement("button", { style: s.reInvoiceBtn, onClick: onInvoice, title: "Re-invoice" }, "✏️")
            )
          : React.createElement("button", { style: s.invoiceBtn, onClick: onInvoice }, "💵 Invoice")
      )
    )
  );
}

const s = {
  card:          { background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 12, padding: "1rem 1.25rem" },
  cardTop:       { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  time:          { fontSize: 12, color: "#888" },
  badge:         { fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 },
  cardTitle:     { fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 },
  cardMeta:      { fontSize: 13, color: "#666", marginBottom: 4 },
  cardDesc:      { fontSize: 13, color: "#888", lineHeight: 1.5, marginBottom: 8, whiteSpace: "pre-line" },
  timesRow:      { display: "flex", gap: 8, margin: "6px 0 2px", flexWrap: "wrap" },
  timeChip:      { fontSize: 12, color: "#444", background: "#f5f5f3", padding: "3px 8px", borderRadius: 6 },
  actionRow:     { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" },
  navButton:     { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#185FA5", color: "#fff", textDecoration: "none", fontWeight: 500, whiteSpace: "nowrap" },
  missedBtn:     { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#FEF3CD", color: "#856404", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  checkInBtn:    { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#FAEEDA", color: "#633806", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  checkOutBtn:   { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#E6F1FB", color: "#0C447C", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  completeBtn:   { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  undoBtn:       { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer", whiteSpace: "nowrap" },
  invoiceBtn:    { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  viewInvoiceBtn:{ fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", textDecoration: "none", fontWeight: 500, display: "inline-block", whiteSpace: "nowrap" },
  reInvoiceBtn:  { fontSize: 12, padding: "6px 8px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 },
  checkedInLabel:{ fontSize: 12, color: "#27500A", padding: "6px 0", fontWeight: 500 },
};
