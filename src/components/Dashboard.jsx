import React, { useState, useEffect, useRef } from "react";
import { useCalendarJobs } from "../hooks/useCalendarJobs";
import InvoiceModal from "./InvoiceModal";

const HOME = { lat: 45.292159, lng: -93.683355 };
const LOG_SHEET_NAME = "TechPortal Job Log 2026";
const STATUS_SHEET_NAME = "Job Status";

const STATUS_STYLES = {
  Scheduled: { bg: "#E6F1FB", color: "#0C447C" },
  "In Progress": { bg: "#FAEEDA", color: "#633806" },
  Done: { bg: "#EAF3DE", color: "#27500A" },
  "Checked In": { bg: "#EAF3DE", color: "#27500A" },
  "Checked Out": { bg: "#F0F4FF", color: "#185FA5" },
};

const MAPS_API_KEY = import.meta.env.VITE_MAPS_API_KEY;

let mapsApiLoaded = false;
function loadMapsApi() {
  if (mapsApiLoaded || window.google?.maps) { mapsApiLoaded = true; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + MAPS_API_KEY + "&libraries=geometry";
    script.async = true;
    script.onload = () => { mapsApiLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function calcMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function getDrivingMiles(fromLat, fromLng, toLat, toLng) {
  try {
    await loadMapsApi();
    return await new Promise((resolve) => {
      const service = new window.google.maps.DistanceMatrixService();
      service.getDistanceMatrix({
        origins: [new window.google.maps.LatLng(fromLat, fromLng)],
        destinations: [new window.google.maps.LatLng(toLat, toLng)],
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.IMPERIAL,
      }, (res, status) => {
        if (status === "OK" && res.rows[0].elements[0].status === "OK") {
          const meters = res.rows[0].elements[0].distance.value;
          resolve(Math.round((meters / 1609.344) * 10) / 10);
        } else {
          resolve(Math.round(calcMiles(fromLat, fromLng, toLat, toLng) * 10) / 10);
        }
      });
    });
  } catch (e) {
    return Math.round(calcMiles(fromLat, fromLng, toLat, toLng) * 10) / 10;
  }
}

export default function Dashboard({ user, accessToken, onLogout }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filter, setFilter] = useState("All");
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [checkedIn, setCheckedIn] = useState({});
  const [checkedOut, setCheckedOut] = useState({});
  const [completed, setCompleted] = useState({});
  const [mileageLog, setMileageLog] = useState(() => {
    try {
      const todayKey = "mileageLog_" + new Date().toDateString();
      const saved = localStorage.getItem(todayKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [navStart, setNavStart] = useState({});
  const [monthlyCount, setMonthlyCount] = useState(null);
  const [monthlyCompleted, setMonthlyCompleted] = useState(0);
  const [monthlyEvents, setMonthlyEvents] = useState([]);
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [invoicedJobs, setInvoicedJobs] = useState({});
  const [dayStarted, setDayStarted] = useState(false);
  const [dayFinished, setDayFinished] = useState(false);
  const [logSheetId, setLogSheetId] = useState(() => localStorage.getItem("techportal_logSheetId") || null);
  const [dayStatus, setDayStatus] = useState("");
  const [modalType, setModalType] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const lastPositionRef = useRef(null);
  const locationRef = useRef(null);
  const pendingStatusRef = useRef({});
  const saveTimerRef = useRef(null);
  const { jobs, loading, error, refresh } = useCalendarJobs(accessToken, selectedDate);

  const isToday = new Date().toDateString() === selectedDate.toDateString();
  const displayDate = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalMiles = mileageLog.reduce((sum, m) => sum + m.miles, 0);
  const monthName = selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const totalCompleted = Object.keys(completed).length + monthlyCompleted;
  const remaining = monthlyCount !== null ? Math.max(0, monthlyCount - totalCompleted) : null;
  const now = new Date();
  const completedEvents = monthlyEvents.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end < now; });
  const remainingEvents = monthlyEvents.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end >= now; });

  useEffect(() => {
    if (!navigator.geolocation) { setLocationError("GPS not supported."); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        locationRef.current = coords;
        setLocation(coords);
        setLocationError(null);
      },
      () => setLocationError("Location access denied."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    setCheckedIn({});
    setCheckedOut({});
    setCompleted({});
    setNavStart({});
    setDayStarted(false);
    setDayFinished(false);
    setDayStatus("");
    setStatusLoading(true);
    if (new Date().toDateString() !== selectedDate.toDateString()) saveMileage([]);
  }, [selectedDate]);

  useEffect(() => { if (!accessToken) return; fetchMonthlyCount(accessToken); }, [accessToken, selectedDate]);
  useEffect(() => { if (!accessToken || loading) return; loadJobStatuses(); }, [accessToken, selectedDate, loading]);

  const saveMileage = (updater) => {
    setMileageLog(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { const todayKey = "mileageLog_" + new Date().toDateString(); localStorage.setItem(todayKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
      setMonthlyEvents(unique);
      setMonthlyCount(unique.length);
      setMonthlyCompleted(pastEvents.length);
    } catch (e) { setMonthlyCount(null); }
  };

  const setAndCacheLogSheetId = (id) => {
    if (id) localStorage.setItem("techportal_logSheetId", id);
    setLogSheetId(id);
  };

  const getOrCreateLogSheet = async () => {
    if (logSheetId) return logSheetId;
    try {
      const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?q=name='" + LOG_SHEET_NAME + "'+and+mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name)", { headers: { Authorization: "Bearer " + accessToken } });
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) { const id = searchData.files[0].id; setAndCacheLogSheetId(id); return id; }
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ properties: { title: LOG_SHEET_NAME }, sheets: [{ properties: { title: "Job Log" } }] }) });
      const createData = await createRes.json();
      const newId = createData.spreadsheetId;
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + newId + "/values/A1:F1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ values: [["Date", "Job", "Check-in Time", "Distance (mi)", "Invoice Sent", "Notes"]] }) });
      setAndCacheLogSheetId(newId);
      return newId;
    } catch (e) { console.error("Log sheet error:", e); return null; }
  };

  const ensureStatusTab = async (sheetId) => {
    const infoRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "?fields=sheets.properties", { headers: { Authorization: "Bearer " + accessToken } });
    const info = await infoRes.json();
    const sheets = info.sheets || [];
    const hasTab = sheets.find(s => s.properties.title === STATUS_SHEET_NAME);
    if (!hasTab) {
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: STATUS_SHEET_NAME } } }] }) });
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A1:D1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ values: [["Date", "Job ID", "Status", "Extra"]] }) });
    }
  };

  const loadJobStatuses = async (isRetry = false) => {
    setStatusLoading(true);
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) { setStatusLoading(false); return; }
      await ensureStatusTab(sheetId);
      const dateKey = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + accessToken } });
      if (!res.ok) { localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); return; }
      const data = await res.json();
      const rows = data.values || [];
      const todayRows = rows.filter(r => r[0] === dateKey);
      if (todayRows.length === 0 && !isRetry && localStorage.getItem("techportal_logSheetId")) {
        localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); loadJobStatuses(true); return;
      }
      const newCheckedIn = {}; const newCheckedOut = {}; const newCompleted = {}; const newInvoiced = {};
      let loadedDayStarted = false; let loadedDayFinished = false; let loadedDayStatus = "";
      todayRows.forEach(row => {
        const [, jobId, status, extra] = row;
        if (jobId === "__DAY_STARTED__") { loadedDayStarted = true; loadedDayStatus = "Day started at " + extra; }
        if (jobId === "__DAY_FINISHED__") { loadedDayStarted = true; loadedDayFinished = true; loadedDayStatus = extra; }
        if (jobId && !jobId.startsWith("__")) {
          const baseJobId = jobId.replace(/__ci$/, "").replace(/__co$/, "").replace(/__done$/, "").replace(/__invoice$/, "").replace(/_\d{8}T\d{6}Z/, "");
          if (status === "checkedIn")  newCheckedIn[baseJobId] = extra || "—";
          if (status === "checkedOut") newCheckedOut[baseJobId] = extra || "—";
          if (status === "completed")  { newCompleted[baseJobId] = true; newCheckedIn[baseJobId] = newCheckedIn[baseJobId] || "—"; }
          if (status === "invoiced")   newInvoiced[baseJobId] = extra || "";
          if (status === "undone")     { delete newCheckedIn[baseJobId]; delete newCheckedOut[baseJobId]; delete newCompleted[baseJobId]; }
        }
      });
      setCheckedIn(newCheckedIn); setCheckedOut(newCheckedOut); setCompleted(newCompleted); setInvoicedJobs(newInvoiced);
      if (loadedDayStarted) { setDayStarted(true); if (!lastPositionRef.current && locationRef.current) lastPositionRef.current = { lat: locationRef.current.lat, lng: locationRef.current.lng }; }
      if (loadedDayFinished) setDayFinished(true);
      if (loadedDayStatus) setDayStatus(loadedDayStatus);
    } catch (e) { console.error("[TechPortal] Could not load job statuses:", e); }
    setStatusLoading(false);
  };

  const queueStatusSave = (jobId, status, extra) => {
    const cleanId = jobId.replace(/_\d{8}T\d{6}Z$/, "");
    pendingStatusRef.current[cleanId] = { status, extra: extra || "" };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushStatusSaves(), 800);
  };

  const flushStatusSaves = async () => {
    const pending = { ...pendingStatusRef.current };
    pendingStatusRef.current = {};
    if (Object.keys(pending).length === 0) return;
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) return;
      const dateKey = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + accessToken } });
      const data = await res.json();
      const rows = data.values || [];
      const existingIndex = {};
      rows.forEach((row, i) => { if (row[0] === dateKey && row[1]) existingIndex[row[1]] = i; });
      const updateRequests = []; const appendRows = [];
      Object.entries(pending).forEach(([jobId, { status, extra }]) => {
        const newRow = [dateKey, jobId, status, extra];
        if (existingIndex[jobId] !== undefined) { updateRequests.push({ range: "'" + STATUS_SHEET_NAME + "'!A" + (existingIndex[jobId] + 1) + ":D" + (existingIndex[jobId] + 1), values: [newRow] }); }
        else { appendRows.push(newRow); }
      });
      if (updateRequests.length > 0) await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values:batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updateRequests }) });
      if (appendRows.length > 0) await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ values: appendRows }) });
    } catch (e) { console.error("Could not flush status saves:", e); }
  };

  const appendToLog = async (row) => {
    const sheetId = await getOrCreateLogSheet();
    if (!sheetId) return;
    await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ values: [row] }) });
  };

  const updateCalendarEvent = async (job, fields) => {
    if (!job?.id || !job?.calendarId) return;
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, { headers: { Authorization: "Bearer " + accessToken } });
      if (!res.ok) return;
      const event = await res.json();
      const existingDesc = event.description || "";
      const stripped = existingDesc.replace(/\n?---TechPortal---[\s\S]*?---End TechPortal---/g, "").trimEnd();
      const lines = ["---TechPortal---"];
      if (fields.checkIn) lines.push("🟢 Check-in: " + fields.checkIn);
      if (fields.checkOut) lines.push("🔴 Check-out: " + fields.checkOut);
      if (fields.completed) lines.push("✅ Completed");
      if (fields.invoiceUrl) lines.push("📄 Invoice: " + fields.invoiceUrl);
      lines.push("---End TechPortal---");
      const newDesc = stripped ? stripped + "\n\n" + lines.join("\n") : lines.join("\n");
      await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ description: newDesc }) });
    } catch (e) { console.warn("Could not update calendar event:", e); }
  };

  const handleStartDay = async () => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    let livePos = locationRef.current;
    if (!livePos) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 5000);
        const check = setInterval(() => { if (locationRef.current) { clearTimeout(timeout); clearInterval(check); resolve(); } }, 200);
      });
      livePos = locationRef.current;
    }
    if (livePos) lastPositionRef.current = { lat: livePos.lat, lng: livePos.lng };
    setDayStarted(true);
    setDayStatus("Day started at " + time);
    await appendToLog([date, "🏠 Start Day (Home)", time, "0", "", "Departed home"]);
    pendingStatusRef.current["__DAY_STARTED__"] = { status: "started", extra: time };
    await flushStatusSaves();
  };

  const handleFinishDay = async () => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || HOME;
    const milesHome = await getDrivingMiles(currentPos.lat, currentPos.lng, HOME.lat, HOME.lng);
    const total = Math.round((totalMiles + milesHome) * 10) / 10;
    setDayFinished(true);
    const status = "Day finished at " + time + " · Total: " + total + " mi";
    setDayStatus(status);
    await appendToLog([date, "🏠 Finish Day (Home)", time, milesHome, "", "Total day: " + total + " mi"]);
    pendingStatusRef.current["__DAY_FINISHED__"] = { status: "finished", extra: status };
    await flushStatusSaves();
  };

  const goToPrevDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); setFilter("All"); };
  const goToNextDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d); setFilter("All"); };
  const goToToday = () => { setSelectedDate(new Date()); setFilter("All"); };
  const handleNavigate = (jobId) => { if (location) setNavStart((prev) => ({ ...prev, [jobId]: { lat: location.lat, lng: location.lng } })); };

  const handleCheckIn = async (jobId, jobTitle) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setCheckedIn((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || HOME;
    const accuracyOk = !livePos || livePos.accuracy <= 500;
    let miles = 0;
    if (dayStarted && lastPositionRef.current && accuracyOk) {
      miles = await getDrivingMiles(lastPositionRef.current.lat, lastPositionRef.current.lng, currentPos.lat, currentPos.lng);
      if (miles > 0.05 && miles < 150) saveMileage((prev) => [...prev, { jobId, jobTitle, miles, time }]);
    } else if (navStart[jobId] && livePos && accuracyOk) {
      miles = await getDrivingMiles(navStart[jobId].lat, navStart[jobId].lng, livePos.lat, livePos.lng);
      if (miles > 0.05 && miles < 150) saveMileage((prev) => [...prev, { jobId, jobTitle, miles, time }]);
    }
    if (livePos) lastPositionRef.current = { lat: livePos.lat, lng: livePos.lng };
    await appendToLog([date, jobTitle, time, miles > 0.05 && miles < 150 ? miles : "", invoicedJobs[jobId] ? "Yes" : "No", ""]);
    pendingStatusRef.current[jobId + "__ci"] = { status: "checkedIn", extra: time };
    flushStatusSaves();
    const job = jobs.find(j => j.id === jobId);
    updateCalendarEvent(job, { checkIn: time });
  };

  const handleCheckOut = async (jobId, jobTitle) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setCheckedOut((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    if (livePos) lastPositionRef.current = { lat: livePos.lat, lng: livePos.lng };
    await appendToLog([date, jobTitle + " (check-out)", time, "", invoicedJobs[jobId] ? "Yes" : "No", ""]);
    pendingStatusRef.current[jobId + "__co"] = { status: "checkedOut", extra: time };
    flushStatusSaves();
    const job = jobs.find(j => j.id === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: time });
  };

  const handleComplete = (jobId) => {
    setCompleted((prev) => ({ ...prev, [jobId]: true }));
    pendingStatusRef.current[jobId + "__done"] = { status: "completed", extra: checkedIn[jobId] || "" };
    flushStatusSaves();
    const job = jobs.find(j => j.id === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: checkedOut[jobId], completed: true, invoiceUrl: invoicedJobs[jobId] });
  };

  const handleUndo = (jobId) => {
    setCompleted((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setCheckedIn((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setCheckedOut((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    saveMileage((prev) => prev.filter((m) => m.jobId !== jobId));
    pendingStatusRef.current[jobId + "__ci"] = { status: "undone", extra: "" };
    pendingStatusRef.current[jobId + "__co"] = { status: "undone", extra: "" };
    pendingStatusRef.current[jobId + "__done"] = { status: "undone", extra: "" };
    flushStatusSaves();
    const job = jobs.find(j => j.id === jobId);
    updateCalendarEvent(job, {});
  };

  const handleInvoice = (job) => {
    setInvoiceJob({ ...job, checkInTime: checkedIn[job.id] || null, checkOutTime: checkedOut[job.id] || null });
  };
  const handleInvoiceClose = () => { setInvoiceJob(null); };
  const handleInvoiceCreated = (jobId, invoiceUrl) => {
    setInvoicedJobs((prev) => ({ ...prev, [jobId]: invoiceUrl }));
    pendingStatusRef.current[jobId.replace(/_\d{8}T\d{6}Z$/, "") + "__invoice"] = { status: "invoiced", extra: invoiceUrl };
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: checkedOut[jobId], completed: !!completed[jobId], invoiceUrl });
  };

  const normalizeId = (id) => id ? id.replace(/_\d{8}T\d{6}Z/, "") : id;

  const getStatus = (job) => {
    const id = normalizeId(job.id);
    if (completed[id]) return "Done";
    if (checkedOut[id]) return "Checked Out";
    if (checkedIn[id]) return "Checked In";
    return "Scheduled";
  };

  const counts = {
    total: jobs.length,
    done: jobs.filter((j) => getStatus(j) === "Done").length,
    inProgress: jobs.filter((j) => getStatus(j) === "Checked In").length,
    scheduled: jobs.filter((j) => getStatus(j) === "Scheduled").length,
  };

  const filtered = filter === "All" ? jobs : jobs.filter((j) => { const s = getStatus(j); return s === filter || (filter === "Done" && completed[normalizeId(j.id)]); });
  const dotStyle = { width: 8, height: 8, borderRadius: "50%", background: location ? "#27500A" : "#888", display: "inline-block", marginRight: 4 };
  const modalEvents = modalType === "completed" ? completedEvents : remainingEvents;
  const modalTitleText = modalType === "completed" ? "Completed This Month" : "Remaining This Month";

  return (
    React.createElement("div", { style: styles.page },
      invoiceJob && React.createElement(InvoiceModal, { job: invoiceJob, accessToken: accessToken, onClose: handleInvoiceClose, onInvoiceCreated: handleInvoiceCreated }),

      menuOpen && React.createElement("div", { style: styles.menuOverlay, onClick: () => setMenuOpen(false) },
        React.createElement("div", { style: styles.menuDrawer, onClick: (e) => e.stopPropagation() },
          React.createElement("div", { style: styles.menuHeader },
            React.createElement("div", { style: styles.menuTitle }, "Menu"),
            React.createElement("button", { style: styles.menuClose, onClick: () => setMenuOpen(false) }, "×")
          ),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "📊 Logs & Reports"),
            React.createElement("a", { href: "#", style: styles.menuItem, onClick: async (e) => { e.preventDefault(); const id = logSheetId || await getOrCreateLogSheet(); if (id) window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit", "_blank"); setMenuOpen(false); } }, "📋 Job Log"),
            React.createElement("a", { href: "#", style: styles.menuItem, onClick: async (e) => { e.preventDefault(); const id = logSheetId || await getOrCreateLogSheet(); if (id) window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit", "_blank"); setMenuOpen(false); } }, "💰 Accounts Receivable")
          ),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "⛳ Golf"),
            React.createElement("a", { href: "/golf", style: styles.menuItem, onClick: () => setMenuOpen(false) }, "⛳ Golf Scorecard")
          ),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "📅 Calendar"),
            React.createElement("a", { href: "https://calendar.google.com/calendar/r", target: "_blank", rel: "noreferrer", style: styles.menuItem, onClick: () => setMenuOpen(false) }, "📆 Google Calendar")
          ),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "⚙️ Account"),
            React.createElement("button", { style: { ...styles.menuItem, background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "system-ui, sans-serif" }, onClick: () => { setMenuOpen(false); onLogout(); } }, "🚪 Sign Out")
          )
        )
      ),

      modalType && React.createElement("div", { style: styles.overlay, onClick: () => setModalType(null) },
        React.createElement("div", { style: styles.modalBox, onClick: (e) => e.stopPropagation() },
          React.createElement("div", { style: styles.modalHeader },
            React.createElement("div", { style: styles.modalTitle }, modalTitleText + " (" + modalEvents.length + ")"),
            React.createElement("button", { style: styles.modalClose, onClick: () => setModalType(null) }, "×")
          ),
          React.createElement("div", { style: styles.modalList },
            modalEvents.length === 0
              ? React.createElement("div", { style: styles.modalEmpty }, "No jobs found.")
              : modalEvents.sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)).map((e) => {
                  const start = new Date(e.start?.dateTime || e.start?.date);
                  const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const timeStr = e.start?.dateTime ? start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
                  const editUrl = e.htmlLink || "https://calendar.google.com/calendar/r";
                  return React.createElement("div", { key: e.id, style: styles.modalRow },
                    React.createElement("div", { style: styles.modalRowDate }, dateStr + (timeStr ? " · " + timeStr : "")),
                    React.createElement("div", { style: styles.modalRowTitle }, e.summary || "Untitled"),
                    e.location && React.createElement("div", { style: styles.modalRowLoc }, "📍 " + e.location),
                    React.createElement("a", { href: editUrl, target: "_blank", rel: "noreferrer", style: styles.editBtn }, "✏️ Edit in Calendar")
                  );
                })
          )
        )
      ),

      React.createElement("div", { style: styles.topbar },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          React.createElement("button", { style: styles.hamburgerBtn, onClick: () => setMenuOpen(true) },
            React.createElement("span", { style: styles.hamburgerLine }),
            React.createElement("span", { style: styles.hamburgerLine }),
            React.createElement("span", { style: styles.hamburgerLine })
          ),
          React.createElement("div", null,
            React.createElement("div", { style: styles.name }, user.name),
            React.createElement("div", { style: styles.email }, user.email)
          )
        ),
        React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } },
          React.createElement("button", { style: styles.refreshBtn, onClick: refresh }, "\u21BB"),
          React.createElement("button", { style: styles.logoutBtn, onClick: onLogout }, "Sign out")
        )
      ),

      React.createElement("div", { style: styles.locationBar },
        React.createElement("span", { style: dotStyle }),
        location
          ? React.createElement("span", { style: styles.locationText },
              "GPS active \u00B7 \u00B1" + location.accuracy + "m",
              location.accuracy > 200 && React.createElement("span", { style: { color: "#c0392b", marginLeft: 6 } }, "⚠️ Poor accuracy — mileage paused"),
              "  ",
              React.createElement("a", { href: "https://www.google.com/maps?q=" + location.lat + "," + location.lng, target: "_blank", rel: "noreferrer", style: styles.locationLink }, "View my location")
            )
          : React.createElement("span", { style: styles.locationText }, locationError || "Getting your location...")
      ),

      React.createElement("div", { style: styles.monthBar },
        React.createElement("div", null, React.createElement("div", { style: styles.monthText }, monthName), React.createElement("div", { style: styles.monthSub }, monthlyCount !== null ? monthlyCount + " total jobs" : "Loading...")),
        React.createElement("div", { style: styles.monthRight },
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("completed") },
            React.createElement("div", { style: styles.monthStatVal }, totalCompleted),
            React.createElement("div", { style: styles.monthStatLabel }, "completed")
          ),
          React.createElement("div", { style: styles.monthDivider }),
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("remaining") },
            React.createElement("div", { style: { ...styles.monthStatVal, color: "#FAEEDA" } }, remaining !== null ? remaining : "-"),
            React.createElement("div", { style: styles.monthStatLabel }, "remaining")
          ),
          isToday && totalMiles > 0 && React.createElement(React.Fragment, null,
            React.createElement("div", { style: styles.monthDivider }),
            React.createElement("div", { style: styles.monthStatBtn },
              React.createElement("div", { style: { ...styles.monthStatVal, color: "#7dd3fc" } }, (Math.round(totalMiles * 10) / 10) + " mi"),
              React.createElement("div", { style: styles.monthStatLabel }, "today")
            )
          )
        )
      ),

      isToday && React.createElement("div", { style: styles.dayBar },
        !dayStarted
          ? React.createElement("button", { style: styles.startBtn, onClick: handleStartDay }, "🚗 Start Day")
          : !dayFinished
            ? React.createElement("button", { style: styles.finishBtn, onClick: handleFinishDay }, "🏁 Finish Day")
            : null,
        dayStatus && React.createElement("div", { style: styles.dayStatus }, dayStatus),
        logSheetId && React.createElement("a", { href: "https://docs.google.com/spreadsheets/d/" + logSheetId, target: "_blank", rel: "noreferrer", style: styles.sheetLink }, "📊 View Job Log")
      ),

      isToday && React.createElement("div", { style: styles.mileageBar },
        React.createElement("div", { style: styles.mileageTitle }, "Today's mileage log"),
        mileageLog.length === 0
          ? React.createElement("div", { style: styles.mileageEmpty }, "No mileage logged yet")
          : mileageLog.map((m, i) => React.createElement("div", { key: i, style: styles.mileageRow }, React.createElement("span", null, m.jobTitle), React.createElement("span", { style: styles.mileageVal }, m.miles + " mi"))),
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
        (loading || statusLoading) && React.createElement("div", { style: styles.message }, "Loading..."),
        error && React.createElement("div", { style: { ...styles.message, color: "#c0392b" } }, error),
        !loading && !statusLoading && !error && filtered.length === 0 && React.createElement("div", { style: styles.message }, "No jobs found for this day."),
        !loading && !statusLoading && filtered.map((job) => {
          const nid = normalizeId(job.id);
          return React.createElement(JobCard, {
            key: job.id, job: job, location: location, status: getStatus(job),
            checkedIn: checkedIn[nid], checkedOut: checkedOut[nid], completed: completed[nid],
            invoiceUrl: invoicedJobs[nid],
            onCheckIn: () => handleCheckIn(nid, job.title),
            onCheckOut: () => handleCheckOut(nid, job.title),
            onComplete: () => handleComplete(nid),
            onNavigate: () => handleNavigate(nid),
            onUndo: () => handleUndo(nid),
            onInvoice: () => handleInvoice({ ...job, id: nid }),
          });
        })
      )
    )
  );
}

function JobCard({ job, location, status, checkedIn, checkedOut, completed, invoiceUrl, onCheckIn, onCheckOut, onComplete, onNavigate, onUndo, onInvoice }) {
  const badge = STATUS_STYLES[status] || STATUS_STYLES["Scheduled"];
  const cleanDesc = job.description ? job.description.replace(/\n?---TechPortal---[\s\S]*?---End TechPortal---/g, "").trim() : "";
  let navigateUrl = null;
  if (job.location) { navigateUrl = location ? "https://www.google.com/maps/dir/" + location.lat + "," + location.lng + "/" + encodeURIComponent(job.location) : "https://www.google.com/maps/search/" + encodeURIComponent(job.location); }

  const streetViewUrl = job.location
    ? "https://maps.googleapis.com/maps/api/streetview?" + new URLSearchParams({ location: job.location, size: "600x120", scale: "2", fov: "90", pitch: "0", key: MAPS_API_KEY })
    : null;

  return (
    React.createElement("div", { style: styles.card },
      React.createElement("div", { style: styles.cardTop },
        React.createElement("span", { style: styles.time }, job.startTime + (job.endTime ? " - " + job.endTime : "")),
        React.createElement("span", { style: { ...styles.badge, background: badge.bg, color: badge.color } }, status)
      ),
      React.createElement("div", { style: styles.cardTitle }, job.title),
      job.location && React.createElement("div", { style: styles.cardMeta }, "\uD83D\uDCCD " + job.location),

      // Street View image — clicking opens the Google Calendar event
      streetViewUrl && React.createElement("a", {
        href: job.calendarLink, target: "_blank", rel: "noreferrer", style: { display: "block", marginBottom: 8 }
      },
        React.createElement("img", {
          src: streetViewUrl,
          alt: "Street View",
          style: { width: "100%", height: 110, objectFit: "cover", borderRadius: 8, display: "block", cursor: "pointer" },
          onError: (e) => { e.target.parentElement.style.display = "none"; }
        })
      ),

      cleanDesc && React.createElement("div", { style: styles.cardDesc }, cleanDesc.slice(0, 120) + (cleanDesc.length > 120 ? "\u2026" : "")),
      (checkedIn || checkedOut) && React.createElement("div", { style: styles.timesRow },
        checkedIn && React.createElement("span", { style: styles.timeChip }, "🟢 In: " + checkedIn),
        checkedOut && React.createElement("span", { style: styles.timeChip }, "🔴 Out: " + checkedOut)
      ),
      React.createElement("div", { style: styles.actionRow },
        navigateUrl && !completed && React.createElement("a", { href: navigateUrl, target: "_blank", rel: "noreferrer", style: styles.navButton, onClick: onNavigate }, "\uD83D\uddFA\uFE0F Navigate"),
        !checkedIn && !completed && React.createElement("button", { style: styles.checkInBtn, onClick: onCheckIn }, "\uD83D\uDCCD Check in"),
        checkedIn && !checkedOut && !completed && React.createElement("button", { style: styles.checkOutBtn, onClick: onCheckOut }, "\uD83D\uDEAA Check out"),
        checkedOut && !completed && React.createElement("button", { style: styles.completeBtn, onClick: onComplete }, "\u2705 Mark complete"),
        (checkedIn || checkedOut) && !completed && React.createElement("button", { style: styles.undoBtn, onClick: onUndo }, "\u21A9 Undo"),
        completed && React.createElement("span", { style: styles.checkedInLabel }, "\u2705 Completed"),
        completed && React.createElement("button", { style: styles.undoBtn, onClick: onUndo }, "\u21A9 Undo"),
        invoiceUrl
          ? React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
              React.createElement("a", { href: invoiceUrl, target: "_blank", rel: "noreferrer", style: styles.viewInvoiceBtn }, "\uD83D\uDCC4 View Invoice"),
              React.createElement("button", { style: styles.reInvoiceBtn, onClick: onInvoice, title: "Create new invoice" }, "\u270F\uFE0F")
            )
          : React.createElement("button", { style: styles.invoiceBtn, onClick: onInvoice }, "\uD83D\uDCB5 Invoice")
      )
    )
  );
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 680, margin: "0 auto", paddingBottom: "2rem" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", borderBottom: "0.5px solid #e0e0e0", background: "#fff" },
  name: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" }, email: { fontSize: 13, color: "#888" },
  hamburgerBtn: { background: "none", border: "none", cursor: "pointer", padding: "4px 6px", display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" },
  hamburgerLine: { display: "block", width: 20, height: 2, background: "#555", borderRadius: 2 },
  refreshBtn: { fontSize: 18, background: "none", border: "none", cursor: "pointer", color: "#555", padding: "4px 8px" },
  logoutBtn: { fontSize: 13, color: "#185FA5", background: "none", border: "none", cursor: "pointer" },
  menuOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 },
  menuDrawer: { position: "absolute", top: 0, left: 0, bottom: 0, width: 260, background: "#fff", boxShadow: "4px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" },
  menuHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.25rem 1rem", borderBottom: "0.5px solid #e0e0e0" },
  menuTitle: { fontSize: 16, fontWeight: 700, color: "#1a1a1a" },
  menuClose: { fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#888" },
  menuSection: { padding: "0.75rem 0", borderBottom: "0.5px solid #f0f0f0" },
  menuSectionLabel: { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 1.25rem 0.4rem" },
  menuItem: { display: "block", padding: "0.65rem 1.25rem", fontSize: 14, color: "#1a1a1a", textDecoration: "none", fontWeight: 500 },
  locationBar: { display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 1.5rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0" },
  locationText: { fontSize: 12, color: "#666" }, locationLink: { color: "#185FA5", fontSize: 12 },
  monthBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.5rem", background: "#185FA5" },
  monthText: { fontSize: 14, fontWeight: 600, color: "#fff" }, monthSub: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  monthRight: { display: "flex", alignItems: "center", gap: 16 },
  monthStatBtn: { textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 },
  monthStatVal: { fontSize: 20, fontWeight: 700, color: "#fff" },
  monthStatLabel: { fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.04em" },
  monthDivider: { width: 1, height: 32, background: "rgba(255,255,255,0.3)" },
  dayBar: { display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1.5rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0", flexWrap: "wrap" },
  startBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, background: "#27500A", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 },
  finishBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, background: "#633806", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 },
  dayStatus: { fontSize: 12, color: "#666" },
  sheetLink: { fontSize: 12, color: "#185FA5", marginLeft: "auto" },
  mileageBar: { margin: "1rem 1.5rem 0", background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 12, padding: "0.75rem 1rem" },
  mileageTitle: { fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 },
  mileageEmpty: { fontSize: 13, color: "#bbb", fontStyle: "italic", paddingBottom: 6 },
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
  checkOutBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#E6F1FB", color: "#0C447C", border: "none", cursor: "pointer", fontWeight: 500 },
  timesRow: { display: "flex", gap: 8, margin: "6px 0 2px", flexWrap: "wrap" },
  timeChip: { fontSize: 12, color: "#444", background: "#f5f5f3", padding: "3px 8px", borderRadius: 6 },
  completeBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "none", cursor: "pointer", fontWeight: 500 },
  undoBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer" },
  invoiceBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 },
  viewInvoiceBtn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", textDecoration: "none", fontWeight: 500, display: "inline-block" },
  reInvoiceBtn: { fontSize: 12, padding: "6px 8px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 },
  checkedInLabel: { fontSize: 12, color: "#27500A", padding: "6px 0", fontWeight: 500 },
  calLink: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#f5f5f3", color: "#555", textDecoration: "none" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" },
  modalBox: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "80vh", display: "flex", flexDirection: "column" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  modalTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" },
  modalClose: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888" },
  modalList: { overflowY: "auto", padding: "0.5rem 0" },
  modalEmpty: { padding: "2rem", textAlign: "center", color: "#888", fontSize: 14 },
  modalRow: { padding: "0.75rem 1.25rem", borderBottom: "0.5px solid #f0f0f0" },
  modalRowDate: { fontSize: 11, color: "#888", marginBottom: 2 },
  modalRowTitle: { fontSize: 14, fontWeight: 500, color: "#1a1a1a" },
  modalRowLoc: { fontSize: 12, color: "#666", marginTop: 2 },
  editBtn: { fontSize: 11, color: "#185FA5", textDecoration: "none", display: "inline-block", marginTop: 4 },
};
