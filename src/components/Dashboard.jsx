import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { useCalendarJobs } from "../hooks/useCalendarJobs";
import InvoiceModal from "./InvoiceModal";
import JobCard from "./JobCard";
import RescheduleModal from "./RescheduleModal";
import DriveMode from "./DriveMode";

const HOME = { lat: 45.292159, lng: -93.683355 };
const LOG_SHEET_NAME = "TechPortal Job Log 2026";
const STATUS_SHEET_NAME = "Job Status";
const JOB_STATUS_CACHE_KEY = "techportal_jobStatus_";
const GEOFENCE_RADIUS_MILES = 0.12; // ~200 meters
const GEOFENCE_DWELL_MS = 30 * 1000; // 30 seconds dwell before auto check-in
const APP_VERSION = "1.1.1";

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
  const straightLine = Math.round(calcMiles(fromLat, fromLng, toLat, toLng) * 10) / 10;
  try {
    await loadMapsApi();
    if (!window.google?.maps?.DistanceMatrixService) return straightLine;
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
        } else { resolve(straightLine); }
      });
    });
  } catch (e) { return straightLine; }
}

async function geocodeAddress(address) {
  if (!address || !MAPS_API_KEY) return null;
  try {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?" + new URLSearchParams({ address, key: MAPS_API_KEY });
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.results[0]) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    }
  } catch {}
  return null;
}

function normalizeId(id) {
  if (!id) return id;
  return id.replace(/_\d{8}T\d{6}Z$/, "").replace(/_[a-z0-9]{26}$/, "");
}

const Dashboard = forwardRef(function Dashboard({ user, accessToken, onLogout }, ref) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filter, setFilter] = useState("All");
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [checkedIn, setCheckedIn] = useState({});
  const [checkedOut, setCheckedOut] = useState({});
  const [completed, setCompleted] = useState({});
  const [mileageLog, setMileageLog] = useState(() => {
    try { const k = "mileageLog_" + new Date().toDateString(); const s = localStorage.getItem(k); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [pastDayStatus, setPastDayStatus] = useState("");
  const [navStart, setNavStart] = useState({});
  const [monthlyCount, setMonthlyCount] = useState(null);
  const [monthlyCompleted, setMonthlyCompleted] = useState(0);
  const [monthlyEvents, setMonthlyEvents] = useState([]);
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [invoicedJobs, setInvoicedJobs] = useState({});
  const [missedJobs, setMissedJobs] = useState(() => { try { return JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]"); } catch { return []; } });
  const [showMissedModal, setShowMissedModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState({});
  const [rescheduleJob, setRescheduleJob] = useState(null); // the missed job being rescheduled
  const [dayStarted, setDayStarted] = useState(false);
  const [dayFinished, setDayFinished] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [gpsWaiting, setGpsWaiting] = useState(false);
  const [logSheetId, setLogSheetId] = useState(() => localStorage.getItem("techportal_logSheetId") || null);
  const [dayStatus, setDayStatus] = useState("");
  const [modalType, setModalType] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [geofenceStatus, setGeofenceStatus] = useState({});
  const [debugLog, setDebugLog] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const [driveMode, setDriveMode] = useState(false);

  const startPosRef = useRef(null);
  const lastPositionRef = useRef((() => { try { const s = localStorage.getItem("techportal_lastPos"); return s ? JSON.parse(s) : null; } catch { return null; } })());
  const setLastPos = (pos) => { lastPositionRef.current = pos; if (pos) { try { localStorage.setItem("techportal_lastPos", JSON.stringify(pos)); } catch {} } };
  const locationRef = useRef(null);
  const selectedDateRef = useRef(selectedDate);
  const pendingStatusRef = useRef({});
  const saveTimerRef = useRef(null);
  const trackIntervalRef = useRef(null);
  const jobCoordsRef = useRef({});
  const geofenceDwellRef = useRef({});
  const checkedInRef = useRef(checkedIn);
  const completedRef = useRef(completed);
  const jobsRef = useRef([]);
  const dayStartedRef = useRef(false);
  const dayFinishedRef = useRef(false);
  // ── KEY FIX: keep accessToken in a ref so async functions always get the latest value ──
  const accessTokenRef = useRef(accessToken);

  const dbg = (msg, type = "info") => {
    const entry = { time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }), msg, type };
    setDebugLog(prev => [entry, ...prev].slice(0, 50));
    console.log("[TechPortal]", msg);
  };

  const [gpsTrack, setGpsTrack] = useState(() => { try { const k = "gpsTrack_" + new Date().toDateString(); const s = localStorage.getItem(k); return s ? JSON.parse(s) : []; } catch { return []; } });
  const { jobs, loading, error, refresh } = useCalendarJobs(accessToken, selectedDate);

  useEffect(() => { checkedInRef.current = checkedIn; }, [checkedIn]);
  useEffect(() => { completedRef.current = completed; }, [completed]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => { dayStartedRef.current = dayStarted; }, [dayStarted]);
  useEffect(() => { dayFinishedRef.current = dayFinished; }, [dayFinished]);
  useEffect(() => {
    accessTokenRef.current = accessToken;
    if (accessToken) dbg("✅ accessToken updated (" + accessToken.slice(0, 10) + "...)");
    else dbg("⚠️ accessToken is null/undefined", "warn");
  }, [accessToken]);

  useImperativeHandle(ref, () => ({ flushPending: () => flushStatusSaves() }));

  const isToday = new Date().toDateString() === selectedDate.toDateString();
  selectedDateRef.current = selectedDate;
  const displayDate = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalMiles = mileageLog.reduce((sum, m) => sum + m.miles, 0);
  const gpsTrackedMiles = gpsTrack.length >= 2 ? Math.round(gpsTrack.reduce((sum, pt, i) => i === 0 ? 0 : sum + calcMiles(gpsTrack[i-1][0], gpsTrack[i-1][1], pt[0], pt[1]), 0) * 10) / 10 : null;
  const displayMiles = gpsTrackedMiles !== null ? gpsTrackedMiles : Math.round(totalMiles * 10) / 10;
  const monthName = selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const totalCompleted = Object.keys(completed).length + monthlyCompleted;
  const remaining = monthlyCount !== null ? Math.max(0, monthlyCount - totalCompleted) : null;
  const now = new Date();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const completedEvents = monthlyEvents.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end < startOfToday; });
  const remainingEvents = monthlyEvents.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end >= now; });

  useEffect(() => {
    if (!navigator.geolocation) { setLocationError("GPS not supported."); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        locationRef.current = c;
        setLocation(c);
        setLocationError(null);

        // ── Geofence check on every GPS update ──────────────────────────
        if (!pos.coords.accuracy || pos.coords.accuracy > 150) return; // skip low accuracy
        const dayStartedNow = dayStartedRef.current;
        const dayFinishedNow = dayFinishedRef.current;
        if (!dayStartedNow || dayFinishedNow) return;
        const currentJobs = jobsRef.current;
        const currentCheckedIn = checkedInRef.current;
        const currentCompleted = completedRef.current;
        const nowMs = Date.now();
        currentJobs.forEach(async (job) => {
          const nid = normalizeId(job.id);
          if (currentCheckedIn[nid] || currentCompleted[nid]) {
            if (geofenceDwellRef.current[nid]) { delete geofenceDwellRef.current[nid]; setGeofenceStatus(prev => { const n = {...prev}; delete n[nid]; return n; }); }
            return;
          }
          const coords = jobCoordsRef.current[nid];
          if (!coords) return;
          const dist = calcMiles(c.lat, c.lng, coords.lat, coords.lng);
          if (dist <= GEOFENCE_RADIUS_MILES) {
            if (!geofenceDwellRef.current[nid]) {
              geofenceDwellRef.current[nid] = nowMs;
              setGeofenceStatus(prev => ({ ...prev, [nid]: "nearby" }));
              dbg("📍 Near " + job.title + " (" + Math.round(dist * 5280) + " ft away)");
            } else if (nowMs - geofenceDwellRef.current[nid] >= GEOFENCE_DWELL_MS) {
              delete geofenceDwellRef.current[nid];
              setGeofenceStatus(prev => { const n = {...prev}; delete n[nid]; return n; });
              dbg("✅ Auto check-in: " + job.title);
              handleCheckIn(nid, job.title, true);
            }
          } else {
            if (geofenceDwellRef.current[nid]) {
              delete geofenceDwellRef.current[nid];
              setGeofenceStatus(prev => { const n = {...prev}; delete n[nid]; return n; });
            }
          }
        });
      },
      () => setLocationError("Location access denied."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    setCheckedIn({}); setCheckedOut({}); setCompleted({}); setNavStart({});
    setDayStarted(false); setDayFinished(false); setDayStatus(""); setPastDayStatus(""); setStatusLoading(true);
    jobCoordsRef.current = {}; geofenceDwellRef.current = {}; setGeofenceStatus({});
    if (new Date().toDateString() !== selectedDate.toDateString()) { try { localStorage.removeItem("techportal_lastPos"); } catch {} lastPositionRef.current = null; }
    try { const ck = JOB_STATUS_CACHE_KEY + selectedDate.toDateString(); const c = localStorage.getItem(ck); if (c) { const { checkedIn: ci, checkedOut: co, completed: comp, invoiced: inv } = JSON.parse(c); if (ci) setCheckedIn(ci); if (co) setCheckedOut(co); if (comp) setCompleted(comp); if (inv) setInvoicedJobs(inv); } } catch {}
    try { const k = "mileageLog_" + selectedDate.toDateString(); const s = localStorage.getItem(k); setMileageLog(s ? JSON.parse(s) : []); } catch { setMileageLog([]); }
    try { const k = "gpsTrack_" + selectedDate.toDateString(); const s = localStorage.getItem(k); setGpsTrack(s ? JSON.parse(s) : []); } catch { setGpsTrack([]); }
  }, [selectedDate]);

  useEffect(() => { if (!accessToken) return; fetchMonthlyCount(accessToken); }, [accessToken, selectedDate]);
  useEffect(() => { if (!accessToken || loading) return; loadJobStatuses(); }, [accessToken, selectedDate, loading]);

  useEffect(() => {
    if (!jobs.length || !dayStarted || !isToday) return;
    jobs.forEach(async (job) => {
      const nid = normalizeId(job.id);
      if (!job.location || jobCoordsRef.current[nid]) return;
      const coords = await geocodeAddress(job.location);
      if (coords) jobCoordsRef.current[nid] = coords;
    });
  }, [jobs, dayStarted, isToday]);

  useEffect(() => {
    if (trackIntervalRef.current) clearInterval(trackIntervalRef.current);
    if (!dayStarted || dayFinished || !isToday) return;
    trackIntervalRef.current = setInterval(() => {
      const pos = locationRef.current;
      if (!pos || pos.accuracy > 300) return;
      // ── GPS track only ──
      setGpsTrack(prev => {
        if (prev.length > 0) { const last = prev[prev.length - 1]; if (calcMiles(last[0], last[1], pos.lat, pos.lng) < 0.01) return prev; }
        const next = [...prev, [parseFloat(pos.lat.toFixed(5)), parseFloat(pos.lng.toFixed(5)), Date.now()]];
        try { localStorage.setItem("gpsTrack_" + new Date().toDateString(), JSON.stringify(next)); } catch {}
        pendingStatusRef.current["__GPS_TRACK__"] = { status: "gpsTrack", extra: JSON.stringify(next) };
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushStatusSaves, 2000);
        return next;
      });
    }, 30 * 1000);
    return () => clearInterval(trackIntervalRef.current);
  }, [dayStarted, dayFinished, isToday]);

  const saveMileage = (updater) => {
    setMileageLog(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("mileageLog_" + new Date().toDateString(), JSON.stringify(next)); } catch {}
      pendingStatusRef.current["__MILEAGE_LOG__"] = { status: "mileageLog", extra: JSON.stringify(next) };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushStatusSaves(), 800);
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
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const pastEvents = unique.filter((e) => { const end = new Date(e.end?.dateTime || e.end?.date); return end < startOfToday; });
      setMonthlyEvents(unique); setMonthlyCount(unique.length); setMonthlyCompleted(pastEvents.length);
    } catch (e) { setMonthlyCount(null); }
  };

  const setAndCacheLogSheetId = (id) => { if (id) localStorage.setItem("techportal_logSheetId", id); setLogSheetId(id); };

  const getOrCreateLogSheet = async () => {
    const token = accessTokenRef.current;
    if (!token) { dbg("❌ getOrCreateLogSheet: no token", "error"); return null; }
    if (logSheetId) return logSheetId;
    try {
      const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?q=name='" + LOG_SHEET_NAME + "'+and+mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name)", { headers: { Authorization: "Bearer " + token } });
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) { const id = searchData.files[0].id; setAndCacheLogSheetId(id); return id; }
      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ properties: { title: LOG_SHEET_NAME }, sheets: [{ properties: { title: "Job Log" } }] }) });
      const createData = await createRes.json();
      const newId = createData.spreadsheetId;
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + newId + "/values/A1:F1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [["Date", "Job", "Check-in Time", "Distance (mi)", "Invoice Sent", "Notes"]] }) });
      setAndCacheLogSheetId(newId);
      return newId;
    } catch (e) { dbg("❌ Log sheet error: " + e.message, "error"); return null; }
  };

  const ensureStatusTab = async (sheetId) => {
    const token = accessTokenRef.current;
    const infoRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "?fields=sheets.properties", { headers: { Authorization: "Bearer " + token } });
    const info = await infoRes.json();
    const hasTab = (info.sheets || []).find(s => s.properties.title === STATUS_SHEET_NAME);
    if (!hasTab) {
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: STATUS_SHEET_NAME } } }] }) });
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A1:D1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [["Date", "Job ID", "Status", "Extra"]] }) });
    }
  };

  const loadJobStatuses = async (isRetry = false) => {
    const token = accessTokenRef.current;
    setStatusLoading(true);
    dbg("📥 Loading job statuses...");
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) { setStatusLoading(false); return; }
      await ensureStatusTab(sheetId);
      const dateKey = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { dbg("❌ Sheets read failed: " + res.status, "error"); localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); return; }
      const data = await res.json();
      const rows = data.values || [];
      const todayRows = rows.filter(r => r[0] === dateKey);
      dbg("📊 Loaded " + todayRows.length + " rows for " + dateKey);
      if (rows.length <= 1 && !isRetry && localStorage.getItem("techportal_logSheetId")) {
        localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); loadJobStatuses(true); return;
      }
      const newCI = {}; const newCO = {}; const newComp = {}; const newInv = {};
      let loadedStarted = false; let loadedFinished = false; let loadedStatus = "";
      let lastMileageRow = null; let lastGpsRow = null;
      todayRows.forEach(row => { if (row[1] === "__MILEAGE_LOG__") lastMileageRow = row; if (row[1] === "__GPS_TRACK__") lastGpsRow = row; });
      if (lastMileageRow) { try { const log = JSON.parse(lastMileageRow[3]); if (Array.isArray(log) && log.length > 0) setMileageLog(log); } catch {} }
      if (lastGpsRow) { try { const track = JSON.parse(lastGpsRow[3]); if (Array.isArray(track) && track.length > 0) setGpsTrack(track); } catch {} }
      todayRows.forEach(row => {
        const [, jobId, status, extra] = row;
        if (jobId === "__DAY_STARTED__") { loadedStarted = true; loadedStatus = "Day started at " + extra; }
        if (jobId === "__DAY_FINISHED__") { if (status !== "unfinished") { loadedStarted = true; loadedFinished = true; loadedStatus = extra; } }
        if (jobId && !jobId.startsWith("__")) {
          const baseId = normalizeId(jobId.replace(/__ci$/, "").replace(/__co$/, "").replace(/__done$/, "").replace(/__invoice$/, ""));
          if (status === "checkedIn") newCI[baseId] = extra || "—";
          if (status === "checkedOut") newCO[baseId] = extra || "—";
          if (status === "completed") { newComp[baseId] = true; newCI[baseId] = newCI[baseId] || "—"; }
          if (status === "invoiced") newInv[baseId] = extra || "";
          if (status === "undone") { delete newCI[baseId]; delete newCO[baseId]; delete newComp[baseId]; }
        }
      });
      setCheckedIn(newCI); setCheckedOut(newCO); setCompleted(newComp); setInvoicedJobs(newInv);
      try { const ck = JOB_STATUS_CACHE_KEY + selectedDate.toDateString(); localStorage.setItem(ck, JSON.stringify({ checkedIn: newCI, checkedOut: newCO, completed: newComp, invoiced: newInv })); } catch {}
      if (loadedStarted) { setDayStarted(true); if (!lastPositionRef.current && locationRef.current) setLastPos({ lat: locationRef.current.lat, lng: locationRef.current.lng }); try { const sp = localStorage.getItem("techportal_startPos"); if (sp) startPosRef.current = JSON.parse(sp); } catch {} }
      if (loadedFinished) setDayFinished(true);
      if (loadedStatus) setDayStatus(loadedStatus);
      dbg("✅ Statuses loaded: " + Object.keys(newCI).length + " CI, " + Object.keys(newCO).length + " CO, " + Object.keys(newComp).length + " done");
    } catch (e) { dbg("❌ loadJobStatuses error: " + e.message, "error"); }
    setStatusLoading(false);
  };

  const flushStatusSaves = async (retryCount = 0) => {
    const token = accessTokenRef.current;
    const pending = { ...pendingStatusRef.current };
    pendingStatusRef.current = {};
    if (Object.keys(pending).length === 0) return;
    dbg("💾 Flushing " + Object.keys(pending).length + " pending saves (token: " + (token ? token.slice(0,8) + "..." : "MISSING") + ")");
    if (!token) { dbg("❌ No token — aborting flush", "error"); Object.assign(pendingStatusRef.current, pending); return; }
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) { dbg("❌ No sheet ID", "error"); return; }
      const dateKey = selectedDateRef.current.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + token } });
      if (res.status === 401) {
        dbg("⚠️ 401 on flush (retry " + retryCount + ")", "warn");
        if (retryCount < 3) { Object.assign(pendingStatusRef.current, pending); setTimeout(() => flushStatusSaves(retryCount + 1), (retryCount + 1) * 2000); }
        else { Object.assign(pendingStatusRef.current, pending); }
        return;
      }
      const data = await res.json();
      const rows = data.values || [];
      const existingIndex = {};
      rows.forEach((row, i) => { if (row[0] === dateKey && row[1]) existingIndex[row[1]] = i; });
      const updateRequests = []; const appendRows = [];
      Object.entries(pending).forEach(([jobId, { status, extra }]) => {
        const newRow = [dateKey, jobId, status, extra];
        if (existingIndex[jobId] !== undefined) updateRequests.push({ range: "'" + STATUS_SHEET_NAME + "'!A" + (existingIndex[jobId] + 1) + ":D" + (existingIndex[jobId] + 1), values: [newRow] });
        else appendRows.push(newRow);
      });
      if (updateRequests.length > 0) {
        const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values:batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updateRequests }) });
        if (!r.ok) { dbg("❌ batchUpdate failed: " + r.status, "error"); if (retryCount < 3) { Object.assign(pendingStatusRef.current, pending); setTimeout(() => flushStatusSaves(retryCount + 1), (retryCount + 1) * 2000); return; } }
        else dbg("✅ Updated " + updateRequests.length + " rows");
      }
      if (appendRows.length > 0) {
        const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: appendRows }) });
        if (!r.ok) { dbg("❌ append failed: " + r.status, "error"); if (retryCount < 3) { Object.assign(pendingStatusRef.current, pending); setTimeout(() => flushStatusSaves(retryCount + 1), (retryCount + 1) * 2000); return; } }
        else dbg("✅ Appended " + appendRows.length + " rows");
      }
    } catch (e) { dbg("❌ flush error: " + e.message, "error"); if (retryCount < 3) { Object.assign(pendingStatusRef.current, pending); setTimeout(() => flushStatusSaves(retryCount + 1), (retryCount + 1) * 2000); } }
  };

  const appendToLog = async (row) => {
    const token = accessTokenRef.current;
    const sheetId = await getOrCreateLogSheet();
    if (!sheetId || !token) return;
    await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
  };

  const updateCalendarEvent = async (job, fields) => {
    const token = accessTokenRef.current;
    if (!job?.id || !job?.calendarId || !token) return;
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) return;
      const event = await res.json();
      const stripped = (event.description || "").replace(/\n?---TechPortal---[\s\S]*?---End TechPortal---/g, "").trimEnd();
      const lines = ["---TechPortal---"];
      if (fields.checkIn) lines.push("🟢 Check-in: " + fields.checkIn);
      if (fields.checkOut) lines.push("🔴 Check-out: " + fields.checkOut);
      if (fields.completed) lines.push("✅ Completed");
      if (fields.invoiceUrl) lines.push("📄 Invoice: " + fields.invoiceUrl);
      lines.push("---End TechPortal---");
      const newDesc = stripped ? stripped + "\n\n" + lines.join("\n") : lines.join("\n");
      await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ description: newDesc }) });
    } catch (e) { console.warn("Could not update calendar event:", e); }
  };

  const handleStartDay = async () => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    setGpsWaiting(true);
    let livePos = locationRef.current;
    if (!livePos || livePos.accuracy > 50) {
      await new Promise(resolve => { const timeout = setTimeout(resolve, 15000); const check = setInterval(() => { const pos = locationRef.current; if (pos && pos.accuracy <= 50) { clearTimeout(timeout); clearInterval(check); resolve(); } }, 500); });
      livePos = locationRef.current;
    }
    setGpsWaiting(false);
    if (livePos) {
      setLastPos({ lat: livePos.lat, lng: livePos.lng });
      startPosRef.current = { lat: livePos.lat, lng: livePos.lng };
      try { localStorage.setItem("techportal_startPos", JSON.stringify(startPosRef.current)); } catch {}
      const startPt = [parseFloat(livePos.lat.toFixed(5)), parseFloat(livePos.lng.toFixed(5)), Date.now()];
      setGpsTrack([startPt]);
      try { localStorage.setItem("gpsTrack_" + new Date().toDateString(), JSON.stringify([startPt])); } catch {}
      pendingStatusRef.current["__GPS_TRACK__"] = { status: "gpsTrack", extra: JSON.stringify([startPt]) };
    }
    setDayStarted(true);
    setDayStatus("Day started at " + time);
    dbg("🚗 Day started at " + time);
    // Reverse geocode start location
    let startLabel = "📍 Start";
    if (livePos && MAPS_API_KEY) {
      try {
        const geoRes = await fetch("https://maps.googleapis.com/maps/api/geocode/json?" + new URLSearchParams({ latlng: livePos.lat + "," + livePos.lng, key: MAPS_API_KEY, result_type: "street_address|sublocality|locality" }));
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results[0]) {
          const parts = geoData.results[0].address_components;
          const streetNum = parts.find(p => p.types.includes("street_number"))?.short_name || "";
          const street = parts.find(p => p.types.includes("route"))?.short_name || "";
          const city = parts.find(p => p.types.includes("locality"))?.short_name || "";
          startLabel = "📍 " + [streetNum, street, city].filter(Boolean).join(" ");
        }
      } catch {}
    }
    saveMileage([{ jobId: "__home__", jobTitle: startLabel, from: "", miles: 0, time, checkIn: time }]);
    await appendToLog([date, "🚗 Start Day (" + startLabel + ")", time, "0", "", "Departed"]);
    pendingStatusRef.current["__DAY_STARTED__"] = { status: "started", extra: time };
    await flushStatusSaves();
  };

  const handleFinishDay = async () => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || HOME;
    const endPt = [parseFloat(currentPos.lat.toFixed(5)), parseFloat(currentPos.lng.toFixed(5)), Date.now()];
    setGpsTrack(prev => {
      const next = [...prev, endPt];
      try { localStorage.setItem("gpsTrack_" + new Date().toDateString(), JSON.stringify(next)); } catch {}
      pendingStatusRef.current["__GPS_TRACK__"] = { status: "gpsTrack", extra: JSON.stringify(next) };
      return next;
    });
    const gpsTotal = gpsTrackedMiles !== null ? gpsTrackedMiles : Math.round(totalMiles * 10) / 10;
    const todayDateStr = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const scheduledJobs = jobs.filter(j => getStatus(j) === "Scheduled");
    if (scheduledJobs.length > 0) {
      const existing = JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]");
      const newMissed = scheduledJobs.map(j => ({ jobId: normalizeId(j.id), jobTitle: j.title, jobLocation: j.location, calendarId: j.calendarId, eventId: j.id, date: todayDateStr, missedAt: Date.now() }));
      const merged = [...existing.filter(m => !newMissed.find(n => n.jobId === m.jobId)), ...newMissed];
      saveMissedJobs(merged);
    }
    setDayFinished(true);
    const status = "Day finished at " + time + " · Total: " + gpsTotal + " mi";
    setDayStatus(status);
    dbg("🏁 " + status);
    await appendToLog([date, "📍 Finish Day", time, "", "", "Total day: " + gpsTotal + " mi"]);
    pendingStatusRef.current["__DAY_FINISHED__"] = { status: "finished", extra: status };
    await flushStatusSaves();
  };

  const goToPrevDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); setFilter("All"); };
  const goToNextDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d); setFilter("All"); };
  const goToToday = () => { setSelectedDate(new Date()); setFilter("All"); };
  const handleNavigate = (jobId) => { if (location) setNavStart((prev) => ({ ...prev, [jobId]: { lat: location.lat, lng: location.lng } })); };

  const handleCheckIn = async (jobId, jobTitle, auto = false) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    dbg("📍 Check-in: " + jobTitle + (auto ? " (auto)" : ""));
    setCheckedIn((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || startPosRef.current || HOME;
    const accuracyOk = !livePos || livePos.accuracy <= 1000;
    let miles = 0;
    if (dayStarted && lastPositionRef.current && accuracyOk) {
      miles = await getDrivingMiles(lastPositionRef.current.lat, lastPositionRef.current.lng, currentPos.lat, currentPos.lng);
      if (miles > 0.05 && miles < 150) saveMileage((prev) => [...prev, { jobId, jobTitle, from: prev.length === 0 ? "Start" : prev[prev.length - 1].jobTitle, miles, time, checkIn: time }]);
    } else if (!auto && navStart[jobId] && livePos && accuracyOk) {
      miles = await getDrivingMiles(navStart[jobId].lat, navStart[jobId].lng, livePos.lat, livePos.lng);
      if (miles > 0.05 && miles < 150) saveMileage((prev) => [...prev, { jobId, jobTitle, from: prev.length === 0 ? "Start" : prev[prev.length - 1].jobTitle, miles, time, checkIn: time }]);
    }
    if (livePos) setLastPos({ lat: livePos.lat, lng: livePos.lng });
    await appendToLog([date, jobTitle + (auto ? " (auto)" : ""), time, miles > 0.05 && miles < 150 ? miles : "", invoicedJobs[jobId] ? "Yes" : "No", auto ? "Auto check-in" : ""]);
    pendingStatusRef.current[jobId + "__ci"] = { status: "checkedIn", extra: time };
    flushStatusSaves();
    const job = jobsRef.current.find(j => normalizeId(j.id) === jobId);
    if (job) updateCalendarEvent(job, { checkIn: time });
  };

  const handleCheckOut = async (jobId, jobTitle) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    dbg("🚪 Check-out: " + jobTitle);
    setCheckedOut((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    if (livePos) setLastPos({ lat: livePos.lat, lng: livePos.lng });
    await appendToLog([date, jobTitle + " (check-out)", time, "", invoicedJobs[jobId] ? "Yes" : "No", ""]);
    saveMileage((prev) => prev.map(m => m.jobId === jobId ? { ...m, checkOut: time } : m));
    pendingStatusRef.current[jobId + "__co"] = { status: "checkedOut", extra: time };
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: time });
  };

  const handleComplete = (jobId) => {
    dbg("✅ Complete: " + jobId);
    setCompleted((prev) => ({ ...prev, [jobId]: true }));
    pendingStatusRef.current[jobId + "__done"] = { status: "completed", extra: checkedIn[jobId] || "" };
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
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
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, {});
  };

  const handleInvoice = (job) => { setInvoiceJob({ ...job, checkInTime: checkedIn[job.id] || null, checkOutTime: checkedOut[job.id] || null }); };
  const handleInvoiceClose = () => { setInvoiceJob(null); };
  const handleInvoiceCreated = (jobId, invoiceUrl) => {
    setInvoicedJobs((prev) => ({ ...prev, [jobId]: invoiceUrl }));
    pendingStatusRef.current[normalizeId(jobId) + "__invoice"] = { status: "invoiced", extra: invoiceUrl };
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: checkedOut[jobId], completed: !!completed[jobId], invoiceUrl });
  };

  const handleUndoFinishDay = async () => {
    setDayFinished(false); setConfirmFinish(false); setDayStatus("Day started — resumed");
    pendingStatusRef.current["__DAY_FINISHED__"] = { status: "unfinished", extra: "" };
    pendingStatusRef.current["__DAY_STARTED__"] = { status: "started", extra: "resumed" };
    saveMileage(prev => prev.filter(m => m.jobId !== "__home__"));
    await flushStatusSaves();
  };

  const saveMissedJobs = (jobs) => { setMissedJobs(jobs); try { localStorage.setItem("techportal_missedJobs", JSON.stringify(jobs)); } catch {} };

  const handleMissed = (jobId, jobTitle, jobLocation, jobCalendarId, jobEventId) => {
    const token = accessTokenRef.current;
    const missed = { jobId, jobTitle, jobLocation, calendarId: jobCalendarId, eventId: jobEventId, date: selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), missedAt: Date.now() };
    const existing = JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]");
    saveMissedJobs([...existing.filter(m => m.jobId !== jobId), missed]);
    setCompleted(prev => ({ ...prev, [jobId]: true }));
    pendingStatusRef.current[jobId + "__done"] = { status: "missed", extra: jobTitle };
    flushStatusSaves();
    if (jobCalendarId && jobEventId && token) {
      fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(jobCalendarId) + "/events/" + jobEventId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ summary: "⚠️ MISSED - " + jobTitle }),
      }).catch(() => {});
    }
  };

  const handleReschedule = async (missed, newStart, newEnd) => {
    const token = accessTokenRef.current;
    if (!missed.calendarId || !missed.eventId) throw new Error("No calendar event linked.");
    await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(missed.calendarId) + "/events/" + missed.eventId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        start: { dateTime: newStart.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: newEnd.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        summary: missed.jobTitle,
      }),
    });
    const updated = missedJobs.filter(m => m.jobId !== missed.jobId);
    saveMissedJobs(updated);
    setRescheduleJob(null);
    refresh();
    if (updated.length === 0) setShowMissedModal(false);
    alert(missed.jobTitle + " rescheduled to " + newStart.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " at " + newStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  };

  const handleViewRoute = () => {
    if (gpsTrack.length < 2) { alert("Not enough GPS data yet."); return; }
    const max = 23; const step = Math.max(1, Math.floor(gpsTrack.length / max));
    const pts = []; for (let i = 0; i < gpsTrack.length; i += step) pts.push(gpsTrack[i]);
    const last = gpsTrack[gpsTrack.length - 1]; if (pts[pts.length - 1] !== last) pts.push(last);
    window.open("https://www.google.com/maps/dir/" + pts.map(p => p[0] + "," + p[1]).join("/"), "_blank");
  };

  const handleAddManualLeg = async () => {
    if (!lastPositionRef.current) { alert("GPS not ready."); return; }
    const livePos = locationRef.current;
    if (!livePos) { alert("GPS not available."); return; }
    const label = prompt("What's this leg for?");
    if (!label) return;
    const from = mileageLog.length > 0 ? mileageLog[mileageLog.length - 1].jobTitle : "Last stop";
    const miles = await getDrivingMiles(lastPositionRef.current.lat, lastPositionRef.current.lng, livePos.lat, livePos.lng);
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (miles > 0.05 && miles < 150) { saveMileage((prev) => [...prev, { jobId: "manual_" + Date.now(), jobTitle: label, from, miles, time, checkIn: time }]); setLastPos({ lat: livePos.lat, lng: livePos.lng }); }
    else { alert("Miles: " + miles + " — too small or too large."); }
  };

  const getStatus = (job) => {
    const id = normalizeId(job.id);
    if (completed[id]) return "Done";
    if (checkedOut[id]) return "Checked Out";
    if (checkedIn[id]) return "Checked In";
    return "Scheduled";
  };

  const counts = { total: jobs.length, done: jobs.filter(j => getStatus(j) === "Done").length, inProgress: jobs.filter(j => getStatus(j) === "Checked In").length, scheduled: jobs.filter(j => getStatus(j) === "Scheduled").length };
  const filtered = filter === "All" ? jobs : jobs.filter(j => { const s = getStatus(j); return s === filter || (filter === "Done" && completed[normalizeId(j.id)]); });
  const dotStyle = { width: 8, height: 8, borderRadius: "50%", background: location ? "#27500A" : "#888", display: "inline-block", marginRight: 4 };
  const modalEvents = modalType === "completed" ? completedEvents : remainingEvents;
  const modalTitleText = modalType === "completed" ? "Completed This Month" : "Remaining This Month";

  return (
    React.createElement("div", { style: styles.page },
      invoiceJob && React.createElement(InvoiceModal, { job: invoiceJob, accessToken, onClose: handleInvoiceClose, onInvoiceCreated: handleInvoiceCreated }),
      rescheduleJob && React.createElement(RescheduleModal, {
        missed: rescheduleJob,
        accessToken: accessTokenRef.current,
        onReschedule: handleReschedule,
        onDismiss: (m) => { saveMissedJobs(missedJobs.filter(x => x.jobId !== m.jobId)); setRescheduleJob(null); },
        onClose: () => { setRescheduleJob(null); setShowMissedModal(true); },
      }),

      // ── Drive Mode ───────────────────────────────────────────────────
      driveMode && React.createElement(DriveMode, {
        jobs, checkedIn, checkedOut, completed, location,
        onCheckIn: (nid, title) => handleCheckIn(nid, title),
        onCheckOut: (nid, title) => handleCheckOut(nid, title),
        onComplete: (nid) => handleComplete(nid),
        dayStarted, displayMiles,
        onExit: () => setDriveMode(false),
      }),

      // ── Debug Panel ──────────────────────────────────────────────────────
      React.createElement("div", { style: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999 } },
        React.createElement("button", {
          onClick: () => setShowDebug(p => !p),
          style: { width: "100%", padding: "6px", background: "#1a1a2e", color: "#7dd3fc", fontSize: 11, fontFamily: "monospace", border: "none", cursor: "pointer", textAlign: "left" }
        }, "🔧 Debug (" + debugLog.length + " logs) — tap to " + (showDebug ? "hide" : "show")),
        showDebug && React.createElement("div", {
          style: { background: "#0d0d1a", color: "#cdd6f4", fontFamily: "monospace", fontSize: 10, padding: "8px", maxHeight: 200, overflowY: "auto", borderTop: "1px solid #333" }
        },
          React.createElement("button", { onClick: () => setDebugLog([]), style: { fontSize: 10, padding: "2px 8px", background: "#333", color: "#fff", border: "none", borderRadius: 4, marginBottom: 4, cursor: "pointer" } }, "Clear"),
          debugLog.map((e, i) => React.createElement("div", { key: i, style: { color: e.type === "error" ? "#f38ba8" : e.type === "warn" ? "#f9e2af" : "#a6e3a1", marginBottom: 2 } }, e.time + " " + e.msg))
        )
      ),

      menuOpen && React.createElement("div", { style: styles.menuOverlay, onClick: () => setMenuOpen(false) },
        React.createElement("div", { style: styles.menuDrawer, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.menuHeader }, React.createElement("div", { style: styles.menuTitle }, "Menu"), React.createElement("button", { style: styles.menuClose, onClick: () => setMenuOpen(false) }, "×")),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "📊 Logs & Reports"),
            React.createElement("a", { href: "#", style: styles.menuItem, onClick: async e => { e.preventDefault(); const id = logSheetId || await getOrCreateLogSheet(); if (id) window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0", "_blank"); setMenuOpen(false); } }, "📋 Job Log"),
            React.createElement("a", { href: "#", style: styles.menuItem, onClick: async e => { e.preventDefault(); const id = logSheetId || await getOrCreateLogSheet(); if (id) window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0", "_blank"); setMenuOpen(false); } }, "💰 Accounts Receivable")
          ),
          React.createElement("div", { style: styles.menuSection }, React.createElement("div", { style: styles.menuSectionLabel }, "⛳ Golf"), React.createElement("a", { href: "/golf", style: styles.menuItem, onClick: () => setMenuOpen(false) }, "⛳ Golf Scorecard")),
          React.createElement("div", { style: styles.menuSection }, React.createElement("div", { style: styles.menuSectionLabel }, "📅 Calendar"), React.createElement("a", { href: "https://calendar.google.com/calendar/r", target: "_blank", rel: "noreferrer", style: styles.menuItem, onClick: () => setMenuOpen(false) }, "📆 Google Calendar")),
          React.createElement("div", { style: styles.menuSection }, React.createElement("div", { style: styles.menuSectionLabel }, "⚙️ Account"), React.createElement("button", { style: { ...styles.menuItem, background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "system-ui, sans-serif" }, onClick: () => { setMenuOpen(false); onLogout(); } }, "🚪 Sign Out"))
        )
      ),
      modalType && React.createElement("div", { style: styles.overlay, onClick: () => setModalType(null) },
        React.createElement("div", { style: styles.modalBox, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.modalHeader }, React.createElement("div", { style: styles.modalTitle }, modalTitleText + " (" + modalEvents.length + ")"), React.createElement("button", { style: styles.modalClose, onClick: () => setModalType(null) }, "×")),
          React.createElement("div", { style: styles.modalList },
            modalEvents.length === 0 ? React.createElement("div", { style: styles.modalEmpty }, "No jobs found.")
              : modalEvents.sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date)).map(e => {
                  const start = new Date(e.start?.dateTime || e.start?.date);
                  const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const timeStr = e.start?.dateTime ? start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
                  return React.createElement("div", { key: e.id, style: styles.modalRow },
                    React.createElement("div", { style: styles.modalRowDate }, dateStr + (timeStr ? " · " + timeStr : "")),
                    React.createElement("div", { style: styles.modalRowTitle }, e.summary || "Untitled"),
                    e.location && React.createElement("div", { style: styles.modalRowLoc }, "📍 " + e.location),
                    React.createElement("a", { href: e.htmlLink || "https://calendar.google.com/calendar/r", target: "_blank", rel: "noreferrer", style: styles.editBtn }, "✏️ Edit in Calendar")
                  );
                })
          )
        )
      ),
      React.createElement("div", { style: styles.topbar },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          React.createElement("button", { style: styles.hamburgerBtn, onClick: () => setMenuOpen(true) }, React.createElement("span", { style: styles.hamburgerLine }), React.createElement("span", { style: styles.hamburgerLine }), React.createElement("span", { style: styles.hamburgerLine })),
          React.createElement("div", null,
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
              React.createElement("div", { style: styles.name }, user.name),
              React.createElement("span", { style: { fontSize: 10, color: "#aaa", background: "#f5f5f3", padding: "2px 6px", borderRadius: 6, fontWeight: 500 } }, "v" + APP_VERSION)
            ),
            React.createElement("div", { style: styles.email }, user.email)
          )
        ),
        React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } },
          isToday && dayStarted && !dayFinished && React.createElement("button", {
            style: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#1a1a2e", color: "#7dd3fc", border: "1px solid #333", cursor: "pointer", fontWeight: 600 },
            onClick: () => setDriveMode(true),
          }, "🚗 Drive"),
          React.createElement("button", { style: styles.refreshBtn, onClick: refresh }, "↻"),
          React.createElement("button", { style: styles.logoutBtn, onClick: onLogout }, "Sign out")
        )
      ),
      missedJobs.length > 0 && React.createElement("div", { style: { background: "#FEF3CD", borderBottom: "0.5px solid #f0c040", padding: "10px 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }, onClick: () => setShowMissedModal(true) },
        React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#856404" } }, "⚠️ " + missedJobs.length + " unfinished job" + (missedJobs.length > 1 ? "s" : "") + " — tap to review"),
        React.createElement("span", { style: { fontSize: 12, color: "#856404" } }, "›")
      ),
      showMissedModal && React.createElement("div", { style: styles.overlay, onClick: () => setShowMissedModal(false) },
        React.createElement("div", { style: styles.modalBox, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.modalHeader }, React.createElement("div", { style: styles.modalTitle }, "⚠️ Unfinished Jobs (" + missedJobs.length + ")"), React.createElement("button", { style: styles.modalClose, onClick: () => setShowMissedModal(false) }, "×")),
          React.createElement("div", { style: styles.modalList },
            missedJobs.map(m => React.createElement("div", { key: m.jobId, style: { ...styles.modalRow, display: "flex", flexDirection: "column", gap: 6 } },
              React.createElement("div", { style: styles.modalRowDate }, "Missed on " + m.date),
              React.createElement("div", { style: styles.modalRowTitle }, m.jobTitle),
              m.jobLocation && React.createElement("div", { style: styles.modalRowLoc }, "📍 " + m.jobLocation),
              React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 6 } },
                React.createElement("button", { style: { fontSize: 12, padding: "5px 12px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 500 }, onClick: () => { setShowMissedModal(false); setRescheduleJob(m); } }, "📅 Reschedule"),
                React.createElement("button", { style: { fontSize: 12, padding: "5px 12px", borderRadius: 8, background: "#f5f5f3", color: "#888", border: "none", cursor: "pointer" }, onClick: () => saveMissedJobs(missedJobs.filter(x => x.jobId !== m.jobId)) }, "Dismiss")
              )
            ))
          )
        )
      ),
      React.createElement("div", { style: styles.locationBar },
        React.createElement("span", { style: dotStyle }),
        location ? React.createElement("span", { style: styles.locationText },
          "GPS active · ±" + location.accuracy + "m",
          location.accuracy > 500 && React.createElement("span", { style: { color: "#c0392b", marginLeft: 6 } }, "⚠️ Poor accuracy"),
          "  ",
          React.createElement("a", { href: "https://www.google.com/maps?q=" + location.lat + "," + location.lng, target: "_blank", rel: "noreferrer", style: styles.locationLink }, "View my location")
        ) : React.createElement("span", { style: { ...styles.locationText, display: "flex", alignItems: "center", gap: 8 } },
          locationError || "Getting your location...",
          locationError && React.createElement("button", { onClick: () => { navigator.geolocation.getCurrentPosition(() => window.location.reload(), () => alert("Tap the 🔒 lock icon → Site settings → Location → Allow, then refresh."), { enableHighAccuracy: true }); }, style: { fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer" } }, "Fix →")
        )
      ),
      React.createElement("div", { style: styles.monthBar },
        React.createElement("div", null, React.createElement("div", { style: styles.monthText }, monthName), React.createElement("div", { style: styles.monthSub }, monthlyCount !== null ? monthlyCount + " total jobs" : "Loading...")),
        React.createElement("div", { style: styles.monthRight },
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("completed") }, React.createElement("div", { style: styles.monthStatVal }, totalCompleted), React.createElement("div", { style: styles.monthStatLabel }, "completed")),
          React.createElement("div", { style: styles.monthDivider }),
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("remaining") }, React.createElement("div", { style: { ...styles.monthStatVal, color: "#FAEEDA" } }, remaining !== null ? remaining : "-"), React.createElement("div", { style: styles.monthStatLabel }, "remaining")),
          isToday && React.createElement(React.Fragment, null,
            React.createElement("div", { style: styles.monthDivider }),
            React.createElement("div", { style: styles.monthStatBtn }, React.createElement("div", { style: { ...styles.monthStatVal, color: "#7dd3fc" } }, displayMiles + " mi"), React.createElement("div", { style: styles.monthStatLabel }, "today"))
          )
        )
      ),
      (isToday || dayStatus) && React.createElement("div", { style: styles.dayBar },
        isToday && (!dayStarted
          ? React.createElement("button", { style: { ...styles.startBtn, opacity: gpsWaiting ? 0.7 : 1, cursor: gpsWaiting ? "default" : "pointer" }, onClick: gpsWaiting ? undefined : handleStartDay, disabled: gpsWaiting }, gpsWaiting ? "📡 Getting GPS..." : "🚗 Start Day")
          : !dayFinished
            ? (confirmFinish
              ? React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                  React.createElement("span", { style: { fontSize: 13, color: "#633806", fontWeight: 600 } }, "Done for the day?"),
                  React.createElement("button", { style: styles.finishBtn, onClick: handleFinishDay }, "✅ Yes, finish"),
                  React.createElement("button", { style: { ...styles.finishBtn, background: "#888" }, onClick: () => setConfirmFinish(false) }, "Cancel")
                )
              : React.createElement("button", { style: styles.finishBtn, onClick: () => setConfirmFinish(true) }, "🏁 Finish Day"))
            : React.createElement("button", { style: { ...styles.finishBtn, background: "#555", fontSize: 12 }, onClick: handleUndoFinishDay }, "↩ Undo Finish")),
        dayStatus && React.createElement("div", { style: styles.dayStatus }, dayStatus),
        logSheetId && React.createElement("a", { href: "https://docs.google.com/spreadsheets/d/" + logSheetId + "/edit#gid=0", target: "_blank", rel: "noreferrer", style: styles.sheetLink }, "📊 View Job Log")
      ),
      (isToday || mileageLog.length > 0) && React.createElement("div", { style: styles.mileageBar },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
          React.createElement("div", { style: styles.mileageTitle }, isToday ? "Today's mileage log" : "Mileage log"),
          isToday && dayStarted && React.createElement("button", { style: { fontSize: 11, padding: "3px 10px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 }, onClick: handleAddManualLeg }, "+ Add leg")
        ),
        mileageLog.length === 0
          ? React.createElement("div", { style: styles.mileageEmpty }, dayStarted ? "Check in to your first job to start tracking" : "Start your day to begin tracking miles")
          : mileageLog.map((m, i) => {
              let duration = "";
              if (m.checkIn && m.checkOut) {
                const parseTime = (t) => { const d = new Date(); const [time, ampm] = t.split(" "); let [h, min] = time.split(":").map(Number); if (ampm === "PM" && h !== 12) h += 12; if (ampm === "AM" && h === 12) h = 0; d.setHours(h, min, 0, 0); return d; };
                const diff = Math.round((parseTime(m.checkOut) - parseTime(m.checkIn)) / 60000);
                if (diff > 0) duration = diff >= 60 ? Math.floor(diff/60) + "h " + (diff%60) + "m" : diff + "m";
              }
              return React.createElement("div", { key: i, style: styles.mileageRow },
                React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, flex: 1 } },
                  React.createElement("span", { style: { fontSize: 11, color: "#aaa" } }, (m.from || "Start") + " →"),
                  React.createElement("span", null, m.jobTitle),
                  duration && React.createElement("span", { style: { fontSize: 11, color: "#888" } }, "⏱ " + (m.checkIn || "") + (m.checkOut ? " – " + m.checkOut : "") + " (" + duration + ")")
                ),
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                  React.createElement("span", { style: styles.mileageVal }, m.miles > 0 ? m.miles + " mi" : "—"),
                  m.jobId !== "__home__" && React.createElement("button", { onClick: () => saveMileage(prev => prev.filter((_, idx) => idx !== i)), style: { fontSize: 14, color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", fontWeight: 700, lineHeight: 1 }, title: "Remove this leg" }, "✕")
                )
              );
            }),
        React.createElement("div", { style: styles.mileageTotal },
          React.createElement("span", null, "Total"),
          React.createElement("div", { style: { textAlign: "right" } },
            React.createElement("div", null, displayMiles + " mi"),
            gpsTrackedMiles !== null && React.createElement("div", { style: { fontSize: 10, color: "#888", marginTop: 1 } }, "GPS tracked")
          )
        ),
        gpsTrack.length >= 2 && React.createElement("button", { onClick: handleViewRoute, style: { marginTop: 10, width: "100%", padding: "8px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 } }, "🗺️ View Route in Maps")
      ),
      React.createElement("div", { style: { ...styles.page, paddingBottom: "3rem" } },
        React.createElement("div", { style: styles.statsGrid },
          [{ label: isToday ? "Today's jobs" : "Day's jobs", val: counts.total }, { label: "Completed", val: counts.done }, { label: "In progress", val: counts.inProgress }, { label: "Scheduled", val: counts.scheduled }]
            .map(s => React.createElement("div", { key: s.label, style: styles.statCard }, React.createElement("div", { style: styles.statLabel }, s.label), React.createElement("div", { style: styles.statVal }, s.val)))
        ),
        React.createElement("div", { style: styles.filterRow },
          ["All", "Scheduled", "Checked In", "Done"].map(f =>
            React.createElement("button", { key: f, style: { ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }, onClick: () => setFilter(f) }, f)
          )
        ),
        React.createElement("div", { style: styles.dateNav },
          React.createElement("button", { style: styles.navBtn, onClick: goToPrevDay }, "← Prev"),
          React.createElement("div", { style: styles.dateCenter }, React.createElement("div", { style: styles.dateLabel }, displayDate), !isToday && React.createElement("button", { style: styles.todayBtn, onClick: goToToday }, "Back to today")),
          React.createElement("button", { style: styles.navBtn, onClick: goToNextDay }, "Next →")
        ),
        React.createElement("div", { style: styles.jobList },
          (loading || statusLoading) && React.createElement("div", { style: styles.message }, "Loading..."),
          error && React.createElement("div", { style: { ...styles.message, color: "#c0392b" } }, error),
          !loading && !statusLoading && !error && filtered.length === 0 && React.createElement("div", { style: styles.message }, "No jobs found for this day."),
          !loading && !statusLoading && filtered.map(job => {
            const nid = normalizeId(job.id);
            const isNearby = geofenceStatus[nid] === "nearby";
            return React.createElement(JobCard, {
              key: job.id, job, location, status: getStatus(job),
              checkedIn: checkedIn[nid], checkedOut: checkedOut[nid], completed: completed[nid],
              invoiceUrl: invoicedJobs[nid], isNearby,
              accessToken: accessTokenRef.current,
              onTimeUpdated: refresh,
              onCheckIn: () => handleCheckIn(nid, job.title),
              onCheckOut: () => handleCheckOut(nid, job.title),
              onComplete: () => handleComplete(nid),
              onNavigate: () => handleNavigate(nid),
              onUndo: () => handleUndo(nid),
              onInvoice: () => handleInvoice({ ...job, id: nid }),
              onMissed: () => handleMissed(nid, job.title, job.location, job.calendarId, job.id),
            });
          })
        )
      )
    )
  );
});

export default Dashboard;

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
  mileageRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#444", padding: "4px 0", borderBottom: "0.5px solid #f5f5f3" },
  mileageVal: { color: "#1a1a1a", fontWeight: 500 },
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
