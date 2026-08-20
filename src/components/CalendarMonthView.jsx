import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useMonthCalendarJobs } from "../hooks/useMonthCalendarJobs";
import { shiftCalendarEventByDays } from "../lib/calendarEvents";

const COLORS = {
  scheduled: { bg: "linear-gradient(135deg, #4FA8F0, #1868C4)", color: "#fff", shadow: "rgba(24,104,196,0.4)" },
  done: { bg: "linear-gradient(135deg, #7ED957, #2E9E3F)", color: "#fff", shadow: "rgba(46,158,63,0.4)" },
  missed: { bg: "linear-gradient(135deg, #FF7A6B, #E13B2B)", color: "#fff", shadow: "rgba(225,59,43,0.4)" },
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DRAG_THRESHOLD_PX = 6;
const TOAST_MS = 6000;

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Strips the "MISSED - " prefix and normalizes case/whitespace so a
// dragged missed job can be compared against a "clean" counterpart already
// on the target day.
function titleKeyFor(title) {
  return (title || "").replace(/^(⚠️ MISSED - )+/i, "").trim().toLowerCase();
}

// Real-world duplicates rarely match byte-for-byte — e.g. a stale "Ozas"
// entry vs. the client's regular "Oza" job. A substring check (either
// direction, 3+ chars to avoid false positives on very short names) catches
// that without needing an exact title match.
function titlesLikelyMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

function daysBetweenKeys(fromKey, toKeyStr) {
  const a = keyToDate(fromKey);
  const b = keyToDate(toKeyStr);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

function statusFor(job) {
  if (job.isMissed) return "missed";
  if (job.isAllDay) return "scheduled";
  const start = job.startRaw ? new Date(job.startRaw) : null;
  if (!start || isNaN(start)) return "scheduled";
  return new Date() < start ? "scheduled" : "done";
}

// TechPortal's own full-day view already shows in-depth status (checked
// in/out, completed, paid) — this month view is a fast-scanning overview,
// so it only distinguishes upcoming / already-passed / missed at a glance.
// Tap any day (or any job chip) to jump into the real day view for details.
// Press-and-drag a job chip to a different day to reschedule it right on
// the calendar (Google Calendar's own event, patched via the API) — a tap
// still opens the day as before; only a drag past a small movement
// threshold is treated as a reschedule.
export default function CalendarMonthView({ accessToken, initialDate, onSelectDay, onClose }) {
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  );
  const { eventsByDay, setEventsByDay, loading, error, refresh } = useMonthCalendarJobs(accessToken, displayMonth);
  const [dropTargetKey, setDropTargetKey] = useState(null);
  const [ghost, setGhost] = useState(null); // { title, x, y }
  const [draggingJobId, setDraggingJobId] = useState(null);
  const [toast, setToast] = useState(null); // { message, onUndo }
  const dragRef = useRef(null); // in-flight drag/gesture info, doesn't need to trigger re-renders
  const toastTimerRef = useRef(null);

  // This is a full-screen overlay on top of the day view (same pattern as
  // the Unpaid Accounts page), but the day view underneath stays mounted
  // and is often taller than the viewport — without this, the page behind
  // scrolls along with its own scrollbar at the same time as this overlay's,
  // showing two scrollbars side by side. Locking body scroll while open
  // (and restoring whatever it was on close) fixes that the same way a
  // modal would.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const today = new Date();
  const todayKey = toKey(today);
  const monthLabel = displayMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weeks = useMemo(() => {
    const year = displayMonth.getFullYear();
    const month = displayMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = new Date(year, month, 1 - startOffset);

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    // Google Calendar shows 5 rows when a 6th row would be entirely next
    // month — matches that instead of always reserving a mostly-empty row.
    while (rows.length > 5 && rows[rows.length - 1].every((d) => d.getMonth() !== month)) {
      rows.pop();
    }
    return rows;
  }, [displayMonth]);

  const goPrevMonth = () => setDisplayMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setDisplayMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => setDisplayMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  const showToast = useCallback((message, onUndo) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // Moves `job` from fromKey's array to toKeyStr's array in local state —
  // used both for the optimistic move on drop and to revert on failure/undo.
  const moveJobLocally = useCallback((job, fromKey, toKeyStr) => {
    setEventsByDay((prev) => {
      const next = { ...prev };
      next[fromKey] = (next[fromKey] || []).filter((j) => j.id !== job.id);
      next[toKeyStr] = [...(next[toKeyStr] || []), job].sort((a, b) => (a.startRaw || "").localeCompare(b.startRaw || ""));
      return next;
    });
  }, [setEventsByDay]);

  const commitMove = useCallback(async (job, fromKey, toKeyStr) => {
    const deltaDays = daysBetweenKeys(fromKey, toKeyStr);
    moveJobLocally(job, fromKey, toKeyStr);
    const targetLabel = keyToDate(toKeyStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    try {
      await shiftCalendarEventByDays(accessToken, job.calendarId, job.id, deltaDays);
      showToast("Moved “" + job.title + "” to " + targetLabel, () => {
        moveJobLocally(job, toKeyStr, fromKey);
        shiftCalendarEventByDays(accessToken, job.calendarId, job.id, -deltaDays).catch(() => refresh());
        setToast(null);
      });
    } catch (e) {
      // Roll back the optimistic move — the real calendar event never
      // actually changed, so the UI shouldn't claim it did.
      moveJobLocally(job, toKeyStr, fromKey);
      showToast("Couldn't move “" + job.title + "” — try again", null);
    }
  }, [accessToken, moveJobLocally, showToast, refresh]);

  const handleChipPointerDown = (e, job, fromKey) => {
    if (e.button !== undefined && e.button !== 0) return; // left-click / primary touch only
    const chip = e.currentTarget;
    chip.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId, job, fromKey,
      startX: e.clientX, startY: e.clientY,
      hasMoved: false,
    };
  };

  const handleChipPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.hasMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!drag.hasMoved) setDraggingJobId(drag.job.id);
    drag.hasMoved = true;
    e.preventDefault();
    setGhost({ title: drag.job.title, x: e.clientX, y: e.clientY });

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest("[data-daykey]") : null;
    setDropTargetKey(cell ? cell.getAttribute("data-daykey") : null);
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;

    if (!drag.hasMoved) {
      // A plain tap — behave exactly like tapping the day cell.
      onSelectDay(keyToDate(drag.fromKey));
    } else if (dropTargetKey && dropTargetKey !== drag.fromKey) {
      // Dragging a stale/missed job onto a day that already has its own
      // separate job for the same client doesn't merge them — it's two
      // real, distinct calendar events, and now both sit on the same day.
      // That's easy to mistake for "the app duplicated it" when it
      // actually just surfaced a second pre-existing entry. Warn before
      // committing so it's a deliberate choice, not a surprise.
      const existing = (eventsByDay[dropTargetKey] || []).find(j => titlesLikelyMatch(titleKeyFor(j.title), titleKeyFor(drag.job.title)));
      if (existing) {
        const targetLabel = keyToDate(dropTargetKey).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const proceed = window.confirm(targetLabel + " already has a job for “" + existing.title.replace(/^(⚠️ MISSED - )+/i, "") + "” — move this one there too? They'll both show up on that day.");
        if (!proceed) { setGhost(null); setDropTargetKey(null); setDraggingJobId(null); return; }
      }
      commitMove(drag.job, drag.fromKey, dropTargetKey);
    }
    setGhost(null);
    setDropTargetKey(null);
    setDraggingJobId(null);
  };

  const handleChipPointerUp = (e) => endDrag(e);
  const handleChipPointerCancel = (e) => {
    dragRef.current = null;
    setGhost(null);
    setDropTargetKey(null);
    setDraggingJobId(null);
  };

  return (
    <div style={styles.overlay}>
      {/* Inline styles can't express :hover, and this app has no separate
          CSS file to add a rule to — a small scoped <style> tag is the
          least-invasive way to get a hover effect on job chips (mouse/
          trackpad only; touch has no hover state, which is expected). */}
      <style>{`
        .tp-job-chip { transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease; }
        .tp-job-chip:hover { transform: translateY(-2px) scale(1.05); filter: brightness(1.1); }
        .tp-icon-btn { transition: transform 0.12s ease, background 0.12s ease; }
        .tp-icon-btn:hover { transform: scale(1.12); background: rgba(255,255,255,0.15); }
        .tp-nav-btn { transition: transform 0.12s ease, background 0.12s ease; }
        .tp-nav-btn:hover { transform: scale(1.15); background: rgba(255,255,255,0.28); }
        .tp-today-btn:hover { color: #fff; }
        .tp-day-cell { transition: background 0.12s ease, box-shadow 0.12s ease; }
      `}</style>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="tp-icon-btn" style={styles.backBtn} onClick={onClose} aria-label="Close month view">←</button>
          <div style={styles.headerTitle}>📅 Job Calendar</div>
        </div>
        <button className="tp-icon-btn" style={styles.refreshBtn} onClick={refresh} title="Refresh">↻</button>
      </div>

      <div style={styles.monthNav}>
        <button className="tp-nav-btn" style={styles.navBtn} onClick={goPrevMonth} aria-label="Previous month">‹</button>
        <div style={styles.monthNavCenter}>
          <div style={styles.monthNavLabel}>{monthLabel}</div>
          <button className="tp-today-btn" style={styles.todayBtn} onClick={goToday}>Today</button>
        </div>
        <button className="tp-nav-btn" style={styles.navBtn} onClick={goNextMonth} aria-label="Next month">›</button>
      </div>

      <div style={styles.hint}>Tap a job to open it · press &amp; drag to reschedule to another day</div>

      {loading && <div style={styles.message}>Loading month…</div>}
      {error && <div style={{ ...styles.message, color: "#c0392b" }}>{error}</div>}

      {!loading && !error && (
        <div style={styles.grid}>
          <div style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} style={styles.weekdayCell}>{w}</div>
            ))}
          </div>
          {weeks.map((row, ri) => (
            <div key={ri} style={styles.weekRow}>
              {row.map((date) => {
                const key = toKey(date);
                const inMonth = date.getMonth() === displayMonth.getMonth();
                const isToday = key === todayKey;
                const isDropTarget = dropTargetKey === key;
                const dayJobs = eventsByDay[key] || [];
                return (
                  <div
                    key={key}
                    data-daykey={key}
                    className="tp-day-cell"
                    style={{
                      ...styles.dayCell,
                      ...(inMonth ? {} : styles.dayCellOutside),
                      ...(isDropTarget ? styles.dayCellDropTarget : {}),
                    }}
                    onClick={() => onSelectDay(date)}
                  >
                    <div style={{ ...styles.dayNumber, ...(isToday ? styles.dayNumberToday : {}) }}>
                      {date.getDate()}
                    </div>
                    <div style={styles.jobChips}>
                      {dayJobs.map((job) => {
                        const c = COLORS[statusFor(job)];
                        const isBeingDragged = draggingJobId === job.id;
                        return (
                          <div
                            key={job.id}
                            className="tp-job-chip"
                            style={{ ...styles.chip, background: c.bg, color: c.color, boxShadow: "0 2px 6px " + c.shadow, ...(isBeingDragged ? styles.chipDragging : {}) }}
                            title={job.title}
                            onPointerDown={(e) => handleChipPointerDown(e, job, key)}
                            onPointerMove={handleChipPointerMove}
                            onPointerUp={handleChipPointerUp}
                            onPointerCancel={handleChipPointerCancel}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {job.isAllDay ? job.title : (job.startTime ? job.startTime + " " : "") + job.title}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {ghost && (
        <div style={{ ...styles.ghost, left: ghost.x, top: ghost.y }}>
          {ghost.title}
        </div>
      )}

      {toast && (
        <div style={styles.toast}>
          <span style={styles.toastText}>{toast.message}</span>
          {toast.onUndo && (
            <button style={styles.toastUndo} onClick={toast.onUndo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", zIndex: 600, overflowY: "auto", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", position: "sticky", top: 0, background: "linear-gradient(135deg, #0F2A4A, #1B4F8C)", zIndex: 2, boxShadow: "0 2px 10px rgba(15,42,74,0.25)" },
  backBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#fff", padding: "4px 6px", borderRadius: 6 },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "0.01em" },
  refreshBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#cfe3f7", padding: "4px 8px", borderRadius: 6 },
  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.5rem", background: "linear-gradient(120deg, #145DA0 0%, #6A3DE8 100%)", boxShadow: "0 3px 12px rgba(90,50,200,0.25)" },
  navBtn: { fontSize: 18, padding: "4px 14px", borderRadius: 8, border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", cursor: "pointer", fontWeight: 700 },
  monthNavCenter: { textAlign: "center" },
  monthNavLabel: { fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.01em" },
  todayBtn: { fontSize: 11, color: "rgba(255,255,255,0.85)", background: "none", border: "none", cursor: "pointer", marginTop: 2, textDecoration: "underline" },
  hint: { fontSize: 11, color: "#999", textAlign: "center", padding: "6px 1rem", background: "#f5f5f3", borderBottom: "0.5px solid #eee" },
  message: { fontSize: 14, color: "#888", padding: "2rem 0", textAlign: "center" },
  grid: { padding: "0 0 2rem" },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "0.5px solid #e0e0e0", background: "#f5f5f3" },
  weekdayCell: { fontSize: 11, fontWeight: 700, color: "#888", textAlign: "center", padding: "6px 2px", textTransform: "uppercase", letterSpacing: "0.03em" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "0.5px solid #eee" },
  dayCell: { minHeight: 64, padding: "4px 3px 6px", borderRight: "0.5px solid #eee", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, boxSizing: "border-box" },
  dayCellOutside: { background: "#fafafa", opacity: 0.45 },
  dayCellDropTarget: { background: "linear-gradient(135deg, #E6F1FB, #EFE7FB)", boxShadow: "inset 0 0 0 2px #6A3DE8" },
  dayNumber: { fontSize: 12, fontWeight: 700, color: "#444", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" },
  dayNumberToday: { background: "linear-gradient(135deg, #FF7A59, #FF3D71)", color: "#fff", boxShadow: "0 2px 8px rgba(255,61,113,0.5)" },
  jobChips: { display: "flex", flexDirection: "column", gap: 2 },
  chip: { fontSize: 10, lineHeight: 1.25, padding: "3px 5px", borderRadius: 6, overflowWrap: "anywhere", cursor: "grab", touchAction: "none", userSelect: "none", WebkitTouchCallout: "none", fontWeight: 700 },
  chipDragging: { opacity: 0.35 },
  ghost: { position: "fixed", zIndex: 700, transform: "translate(-50%, -140%)", background: "linear-gradient(135deg, #185FA5, #6A3DE8)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 8, boxShadow: "0 6px 20px rgba(60,30,140,0.4)", pointerEvents: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  toast: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: "linear-gradient(135deg, #1a1a2e, #2b1a4e)", color: "#fff", fontSize: 13, padding: "10px 14px", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", gap: 12, zIndex: 700, maxWidth: "90vw" },
  toastText: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  toastUndo: { background: "none", border: "none", color: "#a78bfa", fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0 },
};
