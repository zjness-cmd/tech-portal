import React, { useState, useMemo } from "react";
import { useMonthCalendarJobs } from "../hooks/useMonthCalendarJobs";

const COLORS = {
  scheduled: { bg: "#E6F1FB", color: "#0C447C" },
  done: { bg: "#EAF3DE", color: "#27500A" },
  missed: { bg: "#FBE1DE", color: "#B23A24" },
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
export default function CalendarMonthView({ accessToken, initialDate, onSelectDay, onClose }) {
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  );
  const { eventsByDay, loading, error, refresh } = useMonthCalendarJobs(accessToken, displayMonth);

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

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={styles.backBtn} onClick={onClose} aria-label="Close month view">←</button>
          <div style={styles.headerTitle}>📅 Job Calendar</div>
        </div>
        <button style={styles.refreshBtn} onClick={refresh} title="Refresh">↻</button>
      </div>

      <div style={styles.monthNav}>
        <button style={styles.navBtn} onClick={goPrevMonth} aria-label="Previous month">‹</button>
        <div style={styles.monthNavCenter}>
          <div style={styles.monthNavLabel}>{monthLabel}</div>
          <button style={styles.todayBtn} onClick={goToday}>Today</button>
        </div>
        <button style={styles.navBtn} onClick={goNextMonth} aria-label="Next month">›</button>
      </div>

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
                const dayJobs = eventsByDay[key] || [];
                return (
                  <div
                    key={key}
                    style={{ ...styles.dayCell, ...(inMonth ? {} : styles.dayCellOutside) }}
                    onClick={() => onSelectDay(date)}
                  >
                    <div style={{ ...styles.dayNumber, ...(isToday ? styles.dayNumberToday : {}) }}>
                      {date.getDate()}
                    </div>
                    <div style={styles.jobChips}>
                      {dayJobs.map((job) => {
                        const c = COLORS[statusFor(job)];
                        return (
                          <div
                            key={job.id}
                            style={{ ...styles.chip, background: c.bg, color: c.color }}
                            title={job.title}
                            onClick={(e) => { e.stopPropagation(); onSelectDay(date); }}
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
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", zIndex: 600, overflowY: "auto", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", borderBottom: "0.5px solid #e0e0e0", position: "sticky", top: 0, background: "#fff", zIndex: 2 },
  backBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#1a1a1a", padding: "4px 6px" },
  headerTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" },
  refreshBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#555", padding: "4px 8px" },
  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.5rem", background: "#185FA5" },
  navBtn: { fontSize: 18, padding: "4px 14px", borderRadius: 8, border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer", fontWeight: 700 },
  monthNavCenter: { textAlign: "center" },
  monthNavLabel: { fontSize: 15, fontWeight: 700, color: "#fff" },
  todayBtn: { fontSize: 11, color: "rgba(255,255,255,0.85)", background: "none", border: "none", cursor: "pointer", marginTop: 2, textDecoration: "underline" },
  message: { fontSize: 14, color: "#888", padding: "2rem 0", textAlign: "center" },
  grid: { padding: "0 0 2rem" },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "0.5px solid #e0e0e0", background: "#f5f5f3" },
  weekdayCell: { fontSize: 11, fontWeight: 700, color: "#888", textAlign: "center", padding: "6px 2px", textTransform: "uppercase", letterSpacing: "0.03em" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "0.5px solid #eee" },
  dayCell: { minHeight: 64, padding: "4px 3px 6px", borderRight: "0.5px solid #eee", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, boxSizing: "border-box" },
  dayCellOutside: { background: "#fafafa", opacity: 0.45 },
  dayNumber: { fontSize: 12, fontWeight: 600, color: "#444", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" },
  dayNumberToday: { background: "#185FA5", color: "#fff" },
  jobChips: { display: "flex", flexDirection: "column", gap: 2 },
  chip: { fontSize: 10, lineHeight: 1.25, padding: "2px 4px", borderRadius: 4, overflowWrap: "anywhere", cursor: "pointer" },
};
