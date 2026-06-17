import React, { useState, useEffect } from "react";

const CALENDAR_IDS = [
  "primary",
  "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com",
];

// Format "HH:MM" to "9:00 AM"
function formatTime(h, m) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return hour + ":" + String(m).padStart(2, "0") + " " + ampm;
}

// Get available 1-hour slots between 6am-6pm that don't overlap existing events
function getAvailableSlots(events, date, durationMs) {
  const DAY_START = 6; // 6 AM
  const DAY_END = 18;  // 6 PM
  const SLOT_INTERVAL = 30; // 30 min increments

  const dateStr = date.toISOString().split("T")[0];
  // Filter events to this date
  const dayEvents = events.filter(e => {
    const start = new Date(e.start?.dateTime || e.start?.date);
    return start.toISOString().split("T")[0] === dateStr;
  }).map(e => ({
    start: new Date(e.start?.dateTime || e.start?.date),
    end: new Date(e.end?.dateTime || e.end?.date),
    title: e.summary || "Busy",
  }));

  const slots = [];
  for (let h = DAY_START; h < DAY_END; h++) {
    for (let m = 0; m < 60; m += SLOT_INTERVAL) {
      const slotStart = new Date(date);
      slotStart.setHours(h, m, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      if (slotEnd.getHours() > DAY_END || (slotEnd.getHours() === DAY_END && slotEnd.getMinutes() > 0)) continue;

      const conflict = dayEvents.find(e => slotStart < e.end && slotEnd > e.start);
      slots.push({ start: slotStart, end: slotEnd, busy: !!conflict, busyWith: conflict?.title });
    }
  }
  return slots;
}

// Next 7 days starting tomorrow
function getNextDays(n = 7) {
  const days = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

export default function RescheduleModal({ missed, accessToken, onReschedule, onDismiss, onClose }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const days = getNextDays(14);

  // Duration of the original event (default 1 hour)
  const durationMs = 60 * 60 * 1000;

  useEffect(() => {
    if (!selectedDay || !accessToken) return;
    setLoadingEvents(true);
    setSelectedSlot(null);
    setError("");

    const startOfDay = new Date(selectedDay); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDay); endOfDay.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: "true",
      maxResults: "50",
    });

    Promise.all(CALENDAR_IDS.map(id =>
      fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(id) + "/events?" + params, {
        headers: { Authorization: "Bearer " + accessToken },
      }).then(r => r.ok ? r.json() : { items: [] })
    )).then(results => {
      const allEvents = results.flatMap(d => d.items || []);
      setEvents(allEvents);
      setLoadingEvents(false);
    }).catch(() => { setLoadingEvents(false); setError("Could not load calendar."); });
  }, [selectedDay, accessToken]);

  const slots = selectedDay ? getAvailableSlots(events, selectedDay, durationMs) : [];
  const freeSlots = slots.filter(s => !s.busy);
  const busySlots = slots.filter(s => s.busy);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setSaving(true);
    setError("");
    try {
      await onReschedule(missed, selectedSlot.start, selectedSlot.end);
    } catch (e) {
      setError("Reschedule failed: " + e.message);
      setSaving(false);
    }
  };

  return React.createElement("div", {
    style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 4000, padding: "0" },
    onClick: onClose,
  },
    React.createElement("div", {
      style: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" },
      onClick: e => e.stopPropagation(),
    },
      // Header
      React.createElement("div", { style: { padding: "1rem 1.25rem 0.75rem", borderBottom: "0.5px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" } }, "Reschedule"),
          React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, missed.jobTitle),
        ),
        React.createElement("button", { onClick: onClose, style: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888", lineHeight: 1 } }, "×")
      ),

      React.createElement("div", { style: { overflowY: "auto", flex: 1 } },

        // Day selector
        React.createElement("div", { style: { padding: "0.75rem 1.25rem 0" } },
          React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 } }, "Pick a day"),
          React.createElement("div", { style: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 } },
            days.map((day, i) => {
              const isSelected = selectedDay && day.toDateString() === selectedDay.toDateString();
              const dayName = day.toLocaleDateString("en-US", { weekday: "short" });
              const dayNum = day.getDate();
              const month = day.toLocaleDateString("en-US", { month: "short" });
              return React.createElement("button", {
                key: i,
                onClick: () => setSelectedDay(day),
                style: {
                  minWidth: 52, padding: "8px 4px", borderRadius: 10, border: isSelected ? "2px solid #185FA5" : "1px solid #e0e0e0",
                  background: isSelected ? "#185FA5" : "#fff", color: isSelected ? "#fff" : "#1a1a1a",
                  cursor: "pointer", textAlign: "center", flexShrink: 0,
                }
              },
                React.createElement("div", { style: { fontSize: 10, fontWeight: 600, opacity: 0.8 } }, dayName),
                React.createElement("div", { style: { fontSize: 18, fontWeight: 700, lineHeight: 1.2 } }, dayNum),
                React.createElement("div", { style: { fontSize: 10, opacity: 0.8 } }, month)
              );
            })
          )
        ),

        // Slots
        selectedDay && React.createElement("div", { style: { padding: "0.75rem 1.25rem" } },
          loadingEvents
            ? React.createElement("div", { style: { textAlign: "center", color: "#888", fontSize: 13, padding: "1rem 0" } }, "Loading calendar...")
            : React.createElement(React.Fragment, null,

                freeSlots.length === 0 && !loadingEvents && React.createElement("div", { style: { fontSize: 13, color: "#888", padding: "0.5rem 0" } }, "No open slots found for this day."),

                freeSlots.length > 0 && React.createElement("div", { style: { marginBottom: 12 } },
                  React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#27500A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 } }, "✅ Available"),
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
                    freeSlots.map((slot, i) => {
                      const isSelected = selectedSlot && selectedSlot.start.getTime() === slot.start.getTime();
                      return React.createElement("button", {
                        key: i,
                        onClick: () => setSelectedSlot(slot),
                        style: {
                          padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                          border: isSelected ? "2px solid #185FA5" : "1px solid #d0e8d0",
                          background: isSelected ? "#185FA5" : "#EAF3DE",
                          color: isSelected ? "#fff" : "#27500A",
                          cursor: "pointer",
                        }
                      }, formatTime(slot.start.getHours(), slot.start.getMinutes()));
                    })
                  )
                ),

                busySlots.length > 0 && React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 } }, "🔴 Busy"),
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
                    busySlots.map((slot, i) =>
                      React.createElement("div", {
                        key: i,
                        title: slot.busyWith,
                        style: { padding: "6px 12px", borderRadius: 8, fontSize: 13, background: "#f5f5f3", color: "#bbb", border: "1px solid #e0e0e0" }
                      }, formatTime(slot.start.getHours(), slot.start.getMinutes()))
                    )
                  )
                )
              )
        ),

        !selectedDay && React.createElement("div", { style: { padding: "1.5rem", textAlign: "center", color: "#bbb", fontSize: 13 } }, "Pick a day above to see available times"),
      ),

      // Footer
      React.createElement("div", { style: { padding: "0.75rem 1.25rem", borderTop: "0.5px solid #e0e0e0", display: "flex", gap: 8 } },
        error && React.createElement("div", { style: { fontSize: 12, color: "#c0392b", marginBottom: 6, width: "100%" } }, error),
        React.createElement("button", {
          onClick: handleConfirm,
          disabled: !selectedSlot || saving,
          style: { flex: 1, padding: "12px", borderRadius: 10, background: selectedSlot ? "#185FA5" : "#ccc", color: "#fff", border: "none", cursor: selectedSlot ? "pointer" : "default", fontWeight: 600, fontSize: 14, opacity: saving ? 0.7 : 1 }
        }, saving ? "Saving..." : selectedSlot ? "📅 Reschedule to " + formatTime(selectedSlot.start.getHours(), selectedSlot.start.getMinutes()) : "Pick a time"),
        React.createElement("button", {
          onClick: () => onDismiss(missed),
          style: { padding: "12px 16px", borderRadius: 10, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer", fontSize: 13 }
        }, "Dismiss")
      )
    )
  );
}
