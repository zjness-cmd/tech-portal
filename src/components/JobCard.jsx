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

// Convert "7:30 AM" style time to "HH:MM" for <input type="time">
function timeStrToInput(timeStr) {
  if (!timeStr) return "08:00";
  try {
    const [time, ampm] = timeStr.trim().split(" ");
    let [h, m] = time.split(":").map(Number);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  } catch { return "08:00"; }
}

export default function JobCard({
  job, location, status, checkedIn, checkedOut, completed, invoiceUrl,
  onCheckIn, onCheckOut, onComplete, onNavigate, onUndo, onInvoice, onMissed,
  isNearby, accessToken, onTimeUpdated,
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgChecked, setImgChecked] = useState(false);
  const [imgExists, setImgExists] = useState(false);
  const [showCompleteChoice, setShowCompleteChoice] = useState(false);
  const [showTimeEdit, setShowTimeEdit] = useState(false);
  const [newTime, setNewTime] = useState("");
  const [timeSaving, setTimeSaving] = useState(false);
  const [timeError, setTimeError] = useState("");

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

  const showMissed = !checkedIn && !completed && !!onMissed;
  const showCheckIn = !checkedIn && !completed;
  const showCheckOut = checkedIn && !checkedOut && !completed;
  const showComplete = checkedOut && !completed && !showCompleteChoice;
  const showCompleteChoice_ = checkedOut && !completed && showCompleteChoice;
  const showUndo = (checkedIn || checkedOut) && !completed;

  const handleOpenTimeEdit = () => {
    setNewTime(timeStrToInput(job.startTime));
    setTimeError("");
    setShowTimeEdit(true);
  };

  const handleSaveTime = async () => {
    if (!newTime) return;
    if (!job.calendarEventId && !job.id) { setTimeError("No calendar event linked."); return; }
    if (!accessToken) { setTimeError("Not authenticated."); return; }
    setTimeSaving(true);
    setTimeError("");
    try {
      const calendarId = job.calendarId;
      const eventId = job.id;
      // Fetch current event to get start/end
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + eventId, {
        headers: { Authorization: "Bearer " + accessToken },
      });
      if (!res.ok) { setTimeError("Could not fetch event."); setTimeSaving(false); return; }
      const event = await res.json();
      const origStart = new Date(event.start?.dateTime || event.start?.date);
      const origEnd = new Date(event.end?.dateTime || event.end?.date);
      const duration = origEnd - origStart;
      // Build new start from the date of origStart + new time
      const [h, m] = newTime.split(":").map(Number);
      const newStart = new Date(origStart);
      newStart.setHours(h, m, 0, 0);
      const newEnd = new Date(newStart.getTime() + duration);
      const patchRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + eventId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({
          start: { dateTime: newStart.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          end: { dateTime: newEnd.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      if (!patchRes.ok) { setTimeError("Failed to update. Try again."); setTimeSaving(false); return; }
      setShowTimeEdit(false);
      if (onTimeUpdated) onTimeUpdated();
    } catch (e) {
      setTimeError("Error: " + e.message);
    }
    setTimeSaving(false);
  };

  return (
    React.createElement("div", { style: s.card },

      // ── Time edit modal ─────────────────────────────────────────────────
      showTimeEdit && React.createElement("div", {
        style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: "1rem" },
        onClick: () => setShowTimeEdit(false),
      },
        React.createElement("div", { style: { background: "#fff", borderRadius: 16, padding: "1.5rem", width: "100%", maxWidth: 320 }, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 } }, "Edit Start Time"),
          React.createElement("div", { style: { fontSize: 12, color: "#888", marginBottom: 16 } }, job.title + " · Duration stays the same"),
          React.createElement("input", {
            type: "time",
            value: newTime,
            onChange: e => setNewTime(e.target.value),
            style: { width: "100%", fontSize: 24, padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc", marginBottom: 12, boxSizing: "border-box", textAlign: "center" },
          }),
          timeError && React.createElement("div", { style: { fontSize: 12, color: "#c0392b", marginBottom: 8 } }, timeError),
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("button", {
              onClick: handleSaveTime,
              disabled: timeSaving,
              style: { flex: 1, padding: "10px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: timeSaving ? 0.7 : 1 },
            }, timeSaving ? "Saving..." : "Save"),
            React.createElement("button", {
              onClick: () => setShowTimeEdit(false),
              style: { flex: 1, padding: "10px", borderRadius: 8, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer", fontSize: 14 },
            }, "Cancel")
          )
        )
      ),

      // ── Header row ──────────────────────────────────────────────────────
      React.createElement("div", { style: s.cardTop },
        React.createElement("span", {
          style: { ...s.time, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 },
          onClick: handleOpenTimeEdit,
          title: "Tap to reschedule",
        }, job.startTime + (job.endTime ? " - " + job.endTime : "") + " ✎"),
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
          src: streetViewUrl, alt: "Street View",
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
      }, "📍 You're nearby — auto check-in in ~30 sec"),

      // ── Action buttons ──────────────────────────────────────────────────
      React.createElement("div", { style: s.actionRow },

        navigateUrl && !completed &&
          React.createElement("a", { href: navigateUrl, target: "_blank", rel: "noreferrer", style: s.navButton, onClick: onNavigate }, "🗺️ Navigate"),

        showMissed &&
          React.createElement("button", { style: s.missedBtn, onClick: onMissed }, "⚠️ Missed"),

        showCheckIn &&
          React.createElement("button", { style: s.checkInBtn, onClick: onCheckIn }, "📍 Check in"),

        showCheckOut &&
          React.createElement("button", { style: s.checkOutBtn, onClick: onCheckOut }, "🚪 Check out"),

        showComplete &&
          React.createElement("button", { style: s.completeBtn, onClick: () => setShowCompleteChoice(true) }, "✅ Mark complete"),

        showCompleteChoice_ &&
          React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
            React.createElement("span", { style: { fontSize: 12, color: "#444", fontWeight: 500 } }, "How'd it go?"),
            React.createElement("button", { style: s.completeBtn, onClick: () => { setShowCompleteChoice(false); onComplete(); } }, "✅ Completed"),
            React.createElement("button", { style: { ...s.completeBtn, background: "#FEF3CD", color: "#856404" }, onClick: () => { setShowCompleteChoice(false); onMissed && onMissed(); } }, "⚠️ Missed"),
            React.createElement("button", { style: { ...s.undoBtn, fontSize: 11 }, onClick: () => setShowCompleteChoice(false) }, "Cancel")
          ),

        showUndo &&
          React.createElement("button", { style: s.undoBtn, onClick: onUndo }, "↩ Undo"),

        completed && React.createElement("span", { style: s.checkedInLabel }, "✅ Completed"),
        completed && React.createElement("button", { style: s.undoBtn, onClick: onUndo }, "↩ Undo"),

        invoiceUrl
          ? React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
              React.createElement("a", { href: invoiceUrl, target: "_blank", rel: "noreferrer", style: s.viewInvoiceBtn }, "📄 View Invoice"),
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
