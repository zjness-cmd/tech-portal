import React, { useState, useRef } from "react";
import JobDetailModal from "./JobDetailModal";
import { findClientLogo, findClientTapPhoto } from "../clientAssets";

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

// Accepts a bare domain, a full URL, or a URL with a path — normalizes down
// to the bare hostname the logo API expects.
function normalizeDomain(website) {
  if (!website) return null;
  let s = website.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getLogoUrl(website) {
  const domain = normalizeDomain(website);
  // unavatar.io — free, no key required, aggregates favicon/social sources
  // for a domain. fallback=false makes it 404 (rather than a generic avatar
  // placeholder) when nothing's found, so the onError hide-logic works.
  return domain ? "https://unavatar.io/" + domain + "?fallback=false" : null;
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
  onCheckIn, onCheckOut, onComplete, onNavigate, onUndo, onInvoice, onTextInvoice, onMissed,
  isNearby, isAmbiguous, accessToken, onTimeUpdated, onNotesSaved, logSheetId,
  paymentStatus, paymentMethod, onTogglePaid, website, onReschedule,
  tapPhotoUrl: dynamicTapPhotoUrl, onUploadTapPhoto, tapCount, onUpdateTapCount,
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgChecked, setImgChecked] = useState(false);
  const [imgExists, setImgExists] = useState(false);
  const [uploadingTapPhoto, setUploadingTapPhoto] = useState(false);
  const tapFileInputRef = useRef(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [showCompleteChoice, setShowCompleteChoice] = useState(false);
  const [showTimeEdit, setShowTimeEdit] = useState(false);
  const [newTime, setNewTime] = useState("");
  const [timeSaving, setTimeSaving] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [showTapLightbox, setShowTapLightbox] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

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
  // A manually-saved local logo (src/assets/client-logos/) always wins over
  // the auto-discovered website favicon — it's there because it's the real
  // logo, not a best-effort guess from a domain.
  const logoUrl = findClientLogo(job.title) || getLogoUrl(website);
  const showLogo = logoUrl && !logoFailed;
  // A reference photo of the client's actual tap tower/lines — shown
  // alongside Street View, not instead of it: Street View is for finding
  // the building, this is for what's on tap once you're there. A photo
  // taken in the field (dynamicTapPhotoUrl, stored per-client in Sheets —
  // see Dashboard's handleUploadClientTapPhoto) always wins over one
  // dropped into src/assets/client-taps/ at build time, since it's the
  // more current, self-service source.
  const tapPhotoUrl = dynamicTapPhotoUrl || findClientTapPhoto(job.title);

  React.useEffect(() => { setLogoFailed(false); }, [website, job.title]);

  const isMissed = job.title.startsWith("⚠️ MISSED");
  const showMissed = !checkedIn && !completed && !!onMissed;
  const showCheckIn = !checkedIn && !completed;
  const showCheckOut = checkedIn && !checkedOut && !completed;
  const showComplete = checkedOut && !completed && !showCompleteChoice;
  const showCompleteChoice_ = checkedOut && !completed && showCompleteChoice;
  // Navigate is only useful before you've checked in — once you're on site
  // there's nothing left to navigate to. Invoice still lives in the job
  // detail view (tap the card); Undo also has a one-tap button right in
  // this row (see the action row below) since that's the moment it's most
  // likely to actually be needed.
  const showNavigate = !checkedIn && !completed;

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

  const handleTapPhotoFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same/another file be picked again immediately (e.g. retake)
    if (!file || !onUploadTapPhoto) return;
    setUploadingTapPhoto(true);
    try {
      await onUploadTapPhoto(file);
    } finally {
      setUploadingTapPhoto(false);
    }
  };

  return (
    React.createElement("div", { style: s.card },

      // ── Tap tower photo lightbox ─────────────────────────────────────────
      // No CSS files in this project — everything's inline styles — so the
      // zoom-in keyframes are injected as a plain <style> tag right here,
      // scoped to existing only while the lightbox itself is mounted.
      showTapLightbox && React.createElement(React.Fragment, null,
        React.createElement("style", null, `
          @keyframes tapLightboxFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes tapLightboxZoomIn { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          @keyframes tapCountGlow {
            0%, 100% { box-shadow: 0 0 0 2px rgba(255,255,255,0.25) inset, 0 0 14px 2px rgba(255,255,255,0.15); }
            50% { box-shadow: 0 0 0 2px rgba(255,255,255,0.45) inset, 0 0 22px 6px rgba(255,255,255,0.35); }
          }
          @keyframes tapCountShine {
            0% { transform: translate(-60%, -60%) rotate(20deg); }
            45%, 100% { transform: translate(60%, 60%) rotate(20deg); }
          }
        `),
        React.createElement("div", {
          style: {
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 4000,
            background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1.5rem", animation: "tapLightboxFadeIn 0.15s ease-out",
          },
          onClick: () => setShowTapLightbox(false),
        },
          React.createElement("div", {
            style: {
              position: "relative", display: "inline-block", maxWidth: "92vw", maxHeight: "85vh",
              animation: "tapLightboxZoomIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            },
          },
            React.createElement("img", {
              src: tapPhotoUrl, alt: "Tap tower",
              style: { maxWidth: "92vw", maxHeight: "85vh", borderRadius: 12, display: "block", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" },
            }),
            // Large tap count overlay, top-left corner of the enlarged
            // photo — separate from the small corner badge on the card
            // thumbnail, which stays as the tap-to-edit control; this is
            // purely a readable-at-a-glance number once you've already
            // opened the photo full-size. A circular dark badge guarantees
            // contrast against any photo, with a pulsing glow + a sweeping
            // shine pass so it reads as a shiny badge rather than flat text.
            tapCount != null && React.createElement("div", {
              style: {
                position: "absolute", top: "4%", left: "5%",
                width: "min(28vw, 150px)", height: "min(28vw, 150px)",
                borderRadius: "50%", background: "rgba(0,0,0,0.6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", pointerEvents: "none",
                animation: "tapCountGlow 2.6s ease-in-out infinite",
              },
            },
              React.createElement("div", {
                style: {
                  position: "absolute", top: "-30%", left: "-30%",
                  width: "60%", height: "220%",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
                  animation: "tapCountShine 2.6s ease-in-out infinite",
                },
              }),
              React.createElement("span", {
                style: {
                  fontSize: "min(14vw, 72px)", fontWeight: 800, color: "#ddd",
                  lineHeight: 1, userSelect: "none", position: "relative",
                },
              }, tapCount)
            )
          ),
          React.createElement("button", {
            onClick: () => setShowTapLightbox(false),
            style: {
              position: "fixed", top: 16, right: 16, fontSize: 28, lineHeight: 1, width: 44, height: 44,
              borderRadius: "50%", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", cursor: "pointer",
            },
          }, "×")
        )
      ),

      // ── Job Detail Modal ────────────────────────────────────────────────
      showDetail && React.createElement(JobDetailModal, {
        job, accessToken, checkedIn, checkedOut, completed,
        onClose: () => setShowDetail(false),
        onNotesSaved,
        logSheetId,
        onUndo, onInvoice, onTextInvoice, invoiceUrl, paymentStatus, paymentMethod, onTogglePaid,
      }),

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
      React.createElement("div", {
        style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4, cursor: "pointer" },
        onClick: () => setShowDetail(true),
      },
        showLogo && React.createElement("img", {
          src: logoUrl, alt: "",
          style: { width: 44, height: 44, padding: 4, borderRadius: 10, objectFit: "contain", background: "#fff", border: "0.5px solid #eee", flexShrink: 0, boxSizing: "border-box" },
          onError: () => setLogoFailed(true),
        }),
        React.createElement("div", { style: { ...s.cardTitle, marginBottom: 0 } },
          job.title,
          job.notes && React.createElement("span", { style: { fontSize: 11, marginLeft: 6, color: "#185FA5" } }, "📝"),
          job.photos?.length > 0 && React.createElement("span", { style: { fontSize: 11, marginLeft: 4, color: "#185FA5" } }, "📷"),
        )
      ),
      job.location && React.createElement("div", { style: s.cardMeta }, "📍 " + job.location),

      // ── Street View + tap tower photos ───────────────────────────────────
      // No `capture` attribute on purpose — that forces straight to the
      // camera on mobile, skipping the OS's own camera-vs-existing-photo
      // chooser. Leaving it off gets that native picker instead.
      onUploadTapPhoto && React.createElement("input", {
        type: "file", accept: "image/*", ref: tapFileInputRef,
        style: { display: "none" }, onChange: handleTapPhotoFileChange,
      }),
      (showImage || tapPhotoUrl || onUploadTapPhoto) && React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 8 } },
        showImage && React.createElement("a", {
          href: job.calendarLink || "#", target: "_blank", rel: "noreferrer",
          style: { display: "block", flex: 1, minWidth: 0 },
        },
          React.createElement("img", {
            src: streetViewUrl, alt: "Street View",
            style: { width: "100%", height: 110, objectFit: "cover", borderRadius: 8, display: "block" },
            onError: () => setImgFailed(true),
          })
        ),
        tapPhotoUrl
          ? React.createElement("div", { style: { position: "relative", flex: 1, minWidth: 0, width: showImage ? undefined : "100%" } },
              React.createElement("img", {
                src: tapPhotoUrl, alt: "Tap tower",
                style: { width: "100%", height: 110, objectFit: "cover", borderRadius: 8, display: "block", cursor: "zoom-in" },
                onClick: (e) => { e.stopPropagation(); setShowTapLightbox(true); },
              }),
              // Tap count badge — typed in by the tech (at upload time, or
              // any time after by tapping the badge), not detected from the
              // photo. Separate tap target from the photo itself, same
              // reasoning as the retake button below.
              onUpdateTapCount && React.createElement("button", {
                onClick: (e) => { e.stopPropagation(); onUpdateTapCount(); },
                title: tapCount != null ? "Tap to change" : "Tap to set tap count",
                style: {
                  position: "absolute", top: 4, left: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer",
                },
              }, tapCount != null ? tapCount + (tapCount === 1 ? " tap" : " taps") : "+ count"),
              // Retake — separate tap target from the photo itself (which
              // opens the lightbox), same as a camera app's "retake" corner
              // button.
              onUploadTapPhoto && React.createElement("button", {
                onClick: (e) => { e.stopPropagation(); tapFileInputRef.current?.click(); },
                title: "Retake tap photo",
                disabled: uploadingTapPhoto,
                style: {
                  position: "absolute", bottom: 4, right: 4, fontSize: 13, width: 26, height: 26, borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                },
              }, uploadingTapPhoto ? "…" : "📷")
            )
          : onUploadTapPhoto && React.createElement("button", {
              onClick: (e) => { e.stopPropagation(); tapFileInputRef.current?.click(); },
              disabled: uploadingTapPhoto,
              style: {
                flex: 1, minWidth: 0, width: showImage ? undefined : "100%", height: 110, borderRadius: 8,
                border: "1.5px dashed #ccc", background: "#fafafa", color: "#888", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 12,
              },
            },
              React.createElement("span", { style: { fontSize: 20 } }, uploadingTapPhoto ? "⏳" : "📷"),
              uploadingTapPhoto ? "Uploading..." : "Add tap photo"
            )
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
      // Shown instead of the nearby banner when another pending job is close
      // enough that a single GPS fix can't tell which one you're actually
      // at (or right after an Undo) — auto check-in is paused for this job,
      // tap Check In below to confirm it yourself.
      isAmbiguous && !checkedIn && !completed && React.createElement("div", {
        style: { fontSize: 12, color: "#856404", background: "#FEF3CD", borderRadius: 6, padding: "5px 10px", marginBottom: 6, fontWeight: 500 }
      }, "📍 Nearby, but too close to call — tap Check In to confirm"),

      // ── Action buttons ──────────────────────────────────────────────────
      React.createElement("div", { style: s.actionRow },

        navigateUrl && showNavigate &&
          React.createElement("a", { href: navigateUrl, target: "_blank", rel: "noreferrer", style: s.navButton, onClick: onNavigate }, "🗺️ Navigate"),

        showMissed &&
          React.createElement("button", { style: s.missedBtn, onClick: onMissed }, "⚠️ Missed"),

        showCheckIn &&
          React.createElement("button", { style: s.checkInBtn, onClick: onCheckIn }, "📍 Check in"),

        showCheckOut &&
          React.createElement("button", { style: s.checkOutBtn, onClick: onCheckOut }, "🚪 Check out"),

        // Right after checking in (or checking out) is exactly when a
        // wrong auto/mis-tap is most likely to be noticed, so Undo gets a
        // one-tap button in the action row itself instead of only living
        // inside the detail view (tap the card) — that's still there too,
        // this is just a faster path to the same onUndo.
        onUndo && (showCheckOut || showComplete) &&
          React.createElement("button", { style: s.undoBtn, onClick: onUndo }, "↩ Undo"),

        showComplete &&
          React.createElement("button", { style: s.completeBtn, onClick: () => setShowCompleteChoice(true) }, "✅ Mark complete"),

        showCompleteChoice_ &&
          React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
            React.createElement("span", { style: { fontSize: 12, color: "#444", fontWeight: 500 } }, "Paid?"),
            React.createElement("button", { style: s.paidBtn, onClick: () => { setShowCompleteChoice(false); onComplete("paid"); } }, "✅ Paid"),
            React.createElement("button", { style: s.unpaidBtn, onClick: () => { setShowCompleteChoice(false); onComplete("awaiting"); } }, "⏳ Awaiting Payment"),
            React.createElement("button", { style: { ...s.undoBtn, fontSize: 11 }, onClick: () => setShowCompleteChoice(false) }, "Cancel")
          ),

        // Undo and Invoice still live in the job detail view (tap the card
        // to reach them), but the paid/unpaid label itself is tappable
        // right from the card now, so marking a job paid doesn't require
        // opening the detail view first.
        completed && isMissed &&
          React.createElement(React.Fragment, null,
            React.createElement("span", { style: s.checkedInLabel }, "⚠️ Missed"),
            React.createElement("button", { style: s.missedBtn, onClick: onReschedule }, "📅 Reschedule")
          ),

        completed && !isMissed &&
          React.createElement("button", {
            style: { ...s.checkedInLabel, border: "none", background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left" },
            onClick: (e) => { e.stopPropagation(); onTogglePaid && onTogglePaid(); },
          }, "✅ Completed · " + (paymentStatus === "paid" ? "Paid" + (paymentMethod ? " (" + (paymentMethod === "cash" ? "Cash" : paymentMethod === "check" ? "Check" : "CC") + ")" : "") : "Awaiting Payment"))
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
  paidBtn:       { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
  unpaidBtn:     { fontSize: 12, padding: "6px 10px", borderRadius: 8, background: "#FAEEDA", color: "#633806", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" },
};
