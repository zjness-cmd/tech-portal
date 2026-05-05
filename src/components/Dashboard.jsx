import React, { useState, useEffect } from "react";
import { useCalendarJobs } from "../hooks/useCalendarJobs";
import InvoiceModal from "./InvoiceModal";

const STATUS_STYLES = {
  Scheduled: { bg: "#E6F1FB", color: "#0C447C" },
  "In Progress": { bg: "#FAEEDA", color: "#633806" },
  Done: { bg: "#EAF3DE", color: "#27500A" },
  "Checked In": { bg: "#EAF3DE", color: "#27500A" },
};

function calcMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function Dashboard({ user, accessToken, onLogout }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filter, setFilter] = useState("All");
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [checkedIn, setCheckedIn] = useState({});
  const [completed, setCompleted] = useState({});
  const [mileageLog, setMileageLog] = useState([]);
  const [navStart, setNavStart] = useState({});
  const [monthlyCount, setMonthlyCount] = useState(null);
  const [monthlyCompleted, setMonthlyCompleted] = useState(0);
  const [invoiceJob, setInvoiceJob] = useState(null);
  const { jobs, loading, error, refresh } = useCalendarJobs(accessToken, selectedDate);

  const isToday = new Date().toDateString() === selectedDate.toDateString();
  const displayDate = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalMiles = mileageLog.reduce((sum, m) => sum + m.miles, 0);
  const monthName = selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const totalCompleted = Object.keys(completed).length + monthlyCompleted;
  const remaining = monthlyCount !== null ? Math.max(0, monthlyCount - totalCompleted) : null;

  useEffect(() => {
    if (!navigator.geolocation) { setLocationError("GPS not supported."); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }); setLocationError(null); },
      () => setLocationError("Location access denied."),
      { enableHighAccuracy: true, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => { if (!accessToken) return; fetchMonthlyCount(accessToken); }, [accessToken, selectedDate]);

  const fetchMonthlyCount = async (token) => {
    try {
      const year = selectedDate.getFullYear(); const month = selectedDate.getMonth();
      const startOfMonth = new Date(year, month, 1); const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
      const params = new URLSearchParams({ timeMin: startOfMonth.toISOString(), timeMax: endOfMonth.toISOString(), singleEvents: "true", maxResults: "500" });
      const calendarIds = ["primary", "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com"];
      const results = await Promise.all(calendarIds.map((id) => fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(id) + "/events?" + params, { headers: { Authorization: "Bearer " + token } }).then((r) => r.ok ? r.json() : { items: [] })));
      const allEvents = results.flatMap((d) => d.items || []);
      const unique = Array.from(new Map(allEvents.map((e) => [e.id, e])).values());
      const now = new Date();
      const pastEvents = unique.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end < now; });
      setMonthlyCount(unique.length); setMonthlyCompleted(pastEvents.length);
    } catch (e) { setMonthlyCount(null); }
  };

  const goToPrevDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); setFilter("All"); };
  const goToNextDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d); setFilter("All"); };
  const goToToday = () => { setSelectedDate(new Date()); setFilter("All"); };
  const handleNavigate = (jobId) => { if (location) setNavStart((prev) => ({ ...prev, [jobId]: { lat: location.lat, lng: location.lng } })); };
  const handleCheckIn = (jobId, jobTitle) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setCheckedIn((prev) => ({ ...prev, [jobId]: time }));
    if (navStart[jobId] && location) {
      const miles = calcMiles(navStart[jobId].lat, navStart[jobId].lng, location.lat, location.lng);
      if (miles > 0.05) setMileageLog((prev) => [...prev, { jobId, jobTitle, miles: Math.round(miles * 10) / 10, time }]);
    }
  };
  const handleComplete = (jobId) => { setCompleted((prev) => ({ ...prev, [jobId]: true })); };
  const handleUndo = (jobId) => {
    setCompleted((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setCheckedIn((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setMileageLog((prev) => prev.filter((m) => m.jobId !== jobId));
  };

  const getStatus = (job) => {
    if (completed[job.id]) return "Done";
    if (checkedIn[job.id]) return "Checked In";
    return "Scheduled";
  };

  const counts = {
    total: jobs.length,
    done: jobs.filter((j) => completed[j.id]).length,
    inProgress: jobs.filter((j) => checkedIn[j.id] && !completed[j.id]).length,
    scheduled: jobs.filter((j) => !checkedIn[j.id] && !completed[j.id]).length,
  };

  const filtered = filter === "All" ? jobs : jobs.filter((j) => { const s = getStatus(j); return s === filter || (filter === "Done" && completed[j.id]); });
  const dotStyle = { width: 8, height: 8, borderRadius: "50%", background: location ? "#27500A" : "#888", display: "inline-block", marginRight: 4 };

  return (
    React.createElement("div", { style: styles.page },
      invoiceJob && React.createElement(InvoiceModal, { job: invoiceJob, accessToken: accessToken, onClose: () => setInvoiceJob(null) }),
      React.createElement("div", { style: styles.topbar },
        React.createElement("div", null, React.createElement("div", { style: styles.name }, user.name), React.createElement("div", { style: styles.email }, user.email)),
        React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } },
          React.createElement("button", { style: styles.refreshBtn, onClick: refresh }, "\u21BB"),
          React.createElement("button", { style: styles.logoutBtn, onClick: onLogout }, "Sign out")
        )
      ),
      React.createElement("div", { style: styles.locationBar },
        React.createElement("span", { style: dotStyle }),
        location
          ? React.createElement("span", { style: styles.locationText }, "GPS active \u00B7 \u00B1" + location.accuracy + "m  ", React.createElement("a", { href: "https://www.google.com/maps?q=" + location.lat + "," + location.lng, target: "_blank", rel: "noreferrer", style: styles.locationLink }, "View my location"))
          : React.createElement("span", { style: styles.locationText }, locationError || "Getting your location...")
      ),
      React.createElement("div", { style: styles.monthBar },
        React.createElement("div", null, React.createElement("div", { style: styles.monthText }, monthName), React.createElement("div", { style: styles.monthSub }, monthlyCount !== null ? monthlyCount + " total jobs" : "Loading...")),
        React.createElement("div", { style: styles.monthRight },
          React.createElement("div", { style: styles.monthStat }, React.createElement("div", { style: styles.monthStatVal }, totalCompleted), React.createElement("div", { style: styles.monthStatLabel }, "completed")),
          React.createElement("div", { style: styles.monthDivider }),
          React.createElement("div", { style: styles.monthStat }, React.createElement("div", { style: { ...styles.monthStatVal, color: "#FAEEDA" } }, remaining !== null ? remaining : "-"), React.createElement("div", { style: styles.monthStatLabel }, "remaining"))
        )
      ),
      totalMiles > 0 && React.createElement("div", { style: styles.mileageBar },
        React.createElement("div", { style: styles.mileageTitle }, "Today's mileage log"),
        mileageLog.map((m, i) => React.createElement("div", { key: i, style: styles.mileageRow }, React.createElement("span", null, m.jobTitle), React.createElement("span", { style: styles.mileageVal }, m.miles + " mi"))),
        React.createElement("div", { style: styles.mileageTotal }, React.createElement("span", null, "Total"), React.createElement("span", null, (Math.round(totalMiles * 10) / 10) + " mi"))
      ),
      React.createElement("div", { style: styles.statsGrid },
        [{ label: "Today's jobs", val: counts.total }, { label: "Completed", val: counts.done }, { label: "In progress", val: counts.inProgress }, { label: "Scheduled", val: counts.scheduled }]
          .map((s) => React.createElement("div", { key: s.label, style: styles.statCard }, React.createElement("div", { style: styles.statLabel }, s.label), React.createElement("div", { style: styles.statVal }, s.val)))
      ),
      React.createElement("div", { style: styles.filterRow },
        ["All", "Scheduled", "Checked In", "Done"].map((f) =>
          React.createElement("button", { key: f, style: { ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }, onClick: () => setFilter(f) }, f)
        )
      ),
      React.createElement("div", { style: styles.dateNav },
        React.createElement("button", { style: styles.navBtn, onClick: goToPrevDay }, "\u2190 Prev"),
        React.createElement("div", { style: styles.dateCenter }, React.createElement("div", { style: styles.dateLabel }, displayDate), !isToday && React.createElement("button", { style: styles.todayBtn, onClick: goToToday }, "Back to today")),
        React.createElement("button", { style: styles.navBtn, onClick: goToNextDay }, "Next \u2192")
      ),
      React.createElement("div", { style: styles.jobList },
        loading && React.createElement("div", { style: styles.message }, "Loading calendar..."),
        error && React.createElement("div", { style: { ...styles.message, color: "#c0392b" } }, error),
        !loading && !error && filtered.length === 0 && React.createElement("div", { style: styles.message }, "No jobs found for this day."),
        !loading && filtered.map((job) =>
          React.createElement(JobCard, { key: job.id, job: job, location: location, status: getStatus(job), checkedIn: checkedIn[job.id], completed: completed[job.id], onCheckIn: () => handleCheckIn(job.id, job.title), onComplete: () => handleComplete(job.id), onNavigate: () => handleNavigate(job.id), onUndo: () => handleUndo(job.id), onInvoice: () => setInvoiceJob(job) })
        )
      )
    )
  );
}

function JobCard({ job, location, status, checkedIn, completed, onCheckIn, onComplete, onNavigate, onUndo, onInvoice }) {
  const badge = STATUS_STYLES[status] || STATUS_STYLES["Scheduled"];
  let navigateUrl = null;
  if (job.location) { navigateUrl = location ? "https://www.google.com/maps/dir/" + location.lat + "," + location.lng + "/" + encodeURIComponent(job.location) : "https://www.google.com/maps/search/" + encodeURIComponent(job.location); }
  return (
    React.createElement("div", { style: styles.card },
      React.createElement("div", { style: styles.cardTop },
        React.createElement("span", { style: styles.time }, job.startTime + (job.endTime ? " - " + job.endTime : "")),
        React.createElement("span", { style: { ...styles.badge, background: badge.bg, color: badge.color } }, status)
      ),
      React.createElement("div", { style: styles.cardTitle }, job.title),
      job.location && React.createElement("div", { style: styles.cardMeta }, "\uD83D\uDCCD " + job.location),
      job.description && React.createElement("div", { style: styles.cardDesc }, job.description.slice(0, 120) + (job.description.length > 120 ? "\u2026" : "")),
      React.createElement("div", { style: styles.actionRow },
        navigateUrl && !completed && React.createElement("a", { href: navigateUrl, target: "_blank", rel: "noreferrer", style: styles.navButton, onClick: onNavigate }, "\uD83D\uddFA\uFE0F Navigate"),
        !checkedIn && !completed && React.createElement("button", { style: styles.checkInBtn, onClick: onCheckIn }, "\uD83D\uDCCD Check in"),
        checkedIn && !completed && React.createElement("button", { style: styles.completeBtn, onClick: onComplete }, "\u2705 Mark complete"),
        checkedIn && !completed && React.createElement("button", { style: styles.undoBtn, onClick: onUndo }, "\u21A9 Undo"),
        completed && React.createElement("span", { style: styles.checkedInLabel }, "\u2705 Completed" + (checkedIn ? " \u00B7 " + checkedIn : "")),
        completed && React.createElement("button", { style: styles.undoBtn, onClick: onUndo }, "\u21A9 Undo"),
        React.createElement("button", { style: styles.invoiceBtn, onClick: onInvoice }, "\uD83D\uDCB5 Invoice"),
        React.createElement("a", { href: job.calendarLink, target: "_blank", rel: "noreferrer", style: styles.calLink }, "\uD83D\uDCC5 Event")
      )
    )
  );
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 680, margin: "0 auto", paddingBottom: "2rem" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", borderBottom: "0.5px solid #e0e0e0", background: "#fff" },
  name: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" }, email: { fontSize: 13, color: "#888" },
  refreshBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#555", padding: "4px 8px" },
  logoutBtn: { fontSize: 13, color: "#185FA5", background: "none", border: "none", cursor: "pointer" },
  locationBar: { display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 1.5rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0" },
  locationText: { fontSize: 12, color: "#666" }, locationLink: { color: "#185FA5", fontSize: 12 },
  monthBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.5rem", background: "#185FA5" },
  monthText: { fontSize: 14, fontWeight: 600, color: "#fff" }, monthSub: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  monthRight: { display: "flex", alignItems: "center", gap: 16 }, monthStat: { textAlign: "center" },
  monthStatVal: { fontSize: 20, fontWeight: 700, color: "#fff" }, monthStatLabel: { fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.04em" },
  monthDivider: { width: 1, height: 32, background: "rgba(255,255,255,0.3)" },
  mileageBar: { margin: "1rem 1.5rem 0", background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 12, padding: "0.75rem 1rem" },
  mileageTitle: { fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 },
  mileageRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#444", padding: "3px 0" }, mileageVal: { color: "#1a1a1a", fontWeight: 500 },
  mileageTotal: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: "#1a1a1a", borderTop: "0.5px solid #e0e0e0", marginTop: 6, paddingTop: 6 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, padding: "1.25rem 1.5rem 0" },
  statCard: { background: "#f5f5f3", borderRadius: 8, padding: "0.75rem 1rem" }, statLabel: { fontSize: 12, color: "#888", marginBottom: 4 }, statVal: { fontSize: 24, fontWeight: 600, color: "#1a1a1a" },
  filterRow: { display: "flex", gap: 8, padding: "1rem 1.5rem 0", flexWrap: "wrap" },
  filterBtn: { fontSize: 12, padding: "5px 14px", borderRadius: 20, border: "0.5px solid #ccc", background: "#fff", color: "#666", cursor: "pointer" },
  filterActive: { background: "#185FA5", color: "#fff", borderColor: "#185FA5" },
  dateNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem 0" },
  navBtn: { fontSize: 13, padding: "6px 14px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", color: "#1a1a1a", cursor: "pointer" },
  dateCenter: { textAlign: "center" }, dateLabel: { fontSize: 13, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.05em" },
  todayBtn: { fontSize: 12, color: "#185FA5", background: "none", border: "none", cursor: "pointer", marginTop: 2 },
  jobList: { padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", gap: 10 },
  message: { fontSize: 14, color: "#888", padding: "2rem 0", textAlign: "center" },
  card: { background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 12, padding: "1rem 1.25rem" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  time: { fontSize: 12, color: "#888" }, badge: { fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20 },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }, cardMeta: { fontSize: 13, color: "#666", marginBottom: 4 },
  cardDesc: { fontSize: 13, color: "#888", lineHeight: 1.5, marginBottom: 8 },
  actionRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  navButton: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#185FA5", color: "#fff", textDecoration: "none", fontWeight: 500 },
  checkInBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#FAEEDA", color: "#633806", border: "none", cursor: "pointer", fontWeight: 500 },
  completeBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "none", cursor: "pointer", fontWeight: 500 },
  undoBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer" },
  invoiceBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 },
  checkedInLabel: { fontSize: 12, color: "#27500A", padding: "6px 0", fontWeight: 500 },
  calLink: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#f5f5f3", color: "#555", textDecoration: "none" },
};
