import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { useCalendarJobs } from "../hooks/useCalendarJobs";
import InvoiceModal from "./InvoiceModal";
import JobCard from "./JobCard";
import RescheduleModal from "./RescheduleModal";
import DriveMode from "./DriveMode";
import EtsyStats from "./EtsyStats";
import CalendarMonthView from "./CalendarMonthView";

const HOME = { lat: 45.292159, lng: -93.683355 };
const LOG_SHEET_NAME = "TechPortal Job Log 2026";
const STATUS_SHEET_NAME = "Job Status";
const AR_SHEET_NAME = "Accounts Receivable";
const CLIENT_SITES_SHEET_NAME = "Client Websites";
const JOB_STATUS_CACHE_KEY = "techportal_jobStatus_";
const PENDING_SAVES_KEY = "techportal_pendingSaves";
const GEOFENCE_RADIUS_MILES = 0.12;
const GEOFENCE_DWELL_MS = 30 * 1000;
// Readings worse than this are unusable for any distance math (the accuracy
// circle is bigger than a city block) — always skipped, always logged.
// Anything better than this but still noisy (common indoors — malls,
// big-box stores, parking ramps) is no longer thrown away outright; it's
// compensated for in the distance check below instead.
const GEOFENCE_HARD_ACCURACY_CUTOFF_M = 500;
const APP_VERSION = "1.3.1";

// Used to build the mailto: invoice sent from Unpaid Accounts — matches the
// info already used in InvoiceModal.jsx's Sheets invoice path, so both
// invoicing flows show the same business details.
const INVOICE_BUSINESS = { name: "Ness Draft Beer Service", addr1: "PO Box 222", addr2: "Albertville, MN 55301", phone: "612-293-9459" };
const INVOICE_SQUARE_PAY_URL = "https://checkout.square.site/merchant/ML3V5FZFEF5B8/checkout/R6IKWK56UNMU6GSPBHVPLIBY";

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

async function geocodeAddress(address, dbgFn) {
  if (!address) { if (dbgFn) dbgFn("❌ Geocode skipped — no address", "error"); return null; }
  try {
    const url = "/api/geocode?" + new URLSearchParams({ address });
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "OK" && data.results[0]) {
      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    } else {
      if (dbgFn) dbgFn("❌ Geocode API status: " + data.status + (data.error_message ? " — " + data.error_message : ""), "error");
    }
  } catch (e) {
    if (dbgFn) dbgFn("❌ Geocode fetch exception: " + e.message, "error");
  }
  return null;
}

function normalizeId(id) {
  if (!id) return id;
  return id.replace(/_\d{8}T\d{6}Z$/, "").replace(/_[a-z0-9]{26}$/, "");
}

// Personal/non-job calendar entries live on the SAME calendar as real jobs
// (confirmed — B Shift 1/2 are on "Beer Line Cleaning" alongside actual
// client visits), so there's no calendar-ID-based way to separate them.
// This is a manually-maintained title blacklist instead — it'll catch
// recurring patterns like shift labels, but one-off personal entries
// (e.g. "Hot tub maintenance", a convention, an appointment) will slip
// through unless added here. Add more patterns as they come up.
const NON_JOB_TITLE_PATTERNS = [/^B Shift \d+$/i, /^Vacation$/i, /^Hot tub maintenance/i];
function isNonJobEvent(summary) {
  const title = (summary || "").trim();
  return NON_JOB_TITLE_PATTERNS.some(p => p.test(title));
}

// Converts the app's "h:mm AM/PM" time strings (as stored on mileage log
// entries) into a same-day Date object, for elapsed-time math.
function parseClockTime(t) {
  if (!t) return null;
  const parts = t.split(" ");
  if (parts.length !== 2) return null;
  const [time, ampm] = parts;
  let [h, min] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(min)) return null;
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}

const Dashboard = forwardRef(function Dashboard({ user, accessToken, onLogout }, ref) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filter, setFilter] = useState("All");
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [checkedIn, setCheckedIn] = useState({});
  const [checkedOut, setCheckedOut] = useState({});
  const [completed, setCompleted] = useState({});
  const [paymentStatus, setPaymentStatus] = useState({});
  const [jobValues, setJobValues] = useState(() => {
    try { const k = "techportal_jobValues_" + new Date().toDateString(); const s = localStorage.getItem(k); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [mileageLog, setMileageLog] = useState(() => {
    try { const k = "mileageLog_" + new Date().toDateString(); const s = localStorage.getItem(k); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [pastDayStatus, setPastDayStatus] = useState("");
  const [navStart, setNavStart] = useState({});
  const [monthlyCount, setMonthlyCount] = useState(null);
  const [monthlyMiles, setMonthlyMiles] = useState(null);
  const [monthlyCompleted, setMonthlyCompleted] = useState(0);
  const [monthCompletedIds, setMonthCompletedIds] = useState(() => new Set());
  const [monthlyEvents, setMonthlyEvents] = useState([]);
  const [invoiceJob, setInvoiceJob] = useState(null);
  const [invoicedJobs, setInvoicedJobs] = useState({});
  const [missedJobs, setMissedJobs] = useState(() => { try { return JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]"); } catch { return []; } });
  const [showMissedModal, setShowMissedModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState({});
  const [rescheduleJob, setRescheduleJob] = useState(null);
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
  const [debugLog, setDebugLog] = useState(() => {
    try {
      const key = "techportal_debugLog_" + new Date().toDateString();
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showDebug, setShowDebug] = useState(false);
  const [driveMode, setDriveMode] = useState(false);
  const [showEtsy, setShowEtsy] = useState(false);
  const [showMonthView, setShowMonthView] = useState(false);
  const [showUnpaidPage, setShowUnpaidPage] = useState(false);
  // Two-step "From job" picker: null when closed, {step:"pick"} showing a
  // tappable list, {step:"amount", event} showing the amount entry for
  // whichever job was tapped.
  const [arPicker, setArPicker] = useState(null);
  const [arAmountInput, setArAmountInput] = useState("");
  // Amount-owed modal for the job-card Paid/Unpaid toggle — an in-app modal
  // rather than window.prompt(), which is unreliable inside installed/
  // standalone PWAs (some Android builds silently no-op it instead of
  // showing a dialog, leaving the toggle stuck on "unpaid" with no way to
  // enter an amount). null when closed, else {nid, cleanTitle}.
  // payAmountPrompt.kind distinguishes "paid" (asks amount received + how —
  // cash/check) from "unpaid" (asks amount owed, no method — nothing's
  // been collected yet to have a method).
  const [payAmountPrompt, setPayAmountPrompt] = useState(null);
  const [payAmountInput, setPayAmountInput] = useState("");
  const [payMethodInput, setPayMethodInput] = useState(null); // "cash" | "check" | null
  const [paymentMethod, setPaymentMethod] = useState({}); // { [nid]: "cash" | "check" }
  // "Send Invoice" prompt from the Unpaid Accounts page — asks for the
  // customer's email (not otherwise captured anywhere for an AR entry),
  // then opens a pre-filled mailto: so the phone/computer's own mail app
  // sends it — no email-sending backend needed. null when closed, else
  // {key}. The email itself is remembered on the account for next time.
  const [invoiceEmailPrompt, setInvoiceEmailPrompt] = useState(null);
  const [invoiceEmailInput, setInvoiceEmailInput] = useState("");
  // Accounts receivable — persists across days (not scoped to selectedDate
  // like mileage/jobValues), so it lives in its own always-loaded key.
  const [unpaidAccounts, setUnpaidAccounts] = useState(() => {
    try { const s = localStorage.getItem("techportal_unpaidAccounts"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  // Client website → logo lookups, keyed by cleaned/lowercased job title so
  // one entry covers every future visit for the same client rather than
  // needing to be re-entered per calendar event instance. Persists across
  // days like unpaidAccounts, for the same reason.
  const [clientWebsites, setClientWebsites] = useState(() => {
    try { const s = localStorage.getItem("techportal_clientWebsites"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  const startPosRef = useRef((() => { try { const s = localStorage.getItem("techportal_startPos"); return s ? JSON.parse(s) : null; } catch { return null; } })());
  const lastPositionRef = useRef((() => { try { const s = localStorage.getItem("techportal_lastPos"); return s ? JSON.parse(s) : null; } catch { return null; } })());
  const setLastPos = (pos) => { lastPositionRef.current = pos; if (pos) { try { localStorage.setItem("techportal_lastPos", JSON.stringify(pos)); } catch {} } };
  const locationRef = useRef(null);
  const selectedDateRef = useRef(selectedDate);
  const pendingStatusRef = useRef({});
  const saveTimerRef = useRef(null);
  const trackIntervalRef = useRef(null);
  const jobCoordsRef = useRef({});
  const arLoadedRef = useRef(false);
  const clientSitesLoadedRef = useRef(false);
  const websiteLookupAttemptedRef = useRef({});
  const geofenceDwellRef = useRef({});
  const departureDwellRef = useRef({});
  const checkedInRef = useRef(checkedIn);
  const completedRef = useRef(completed);
  const checkedOutRef = useRef(checkedOut);
  const mileageLogRef = useRef([]);
  const gpsTrackRef = useRef([]);
  const loadingStatusesRef = useRef(false);
  const flushInFlightRef = useRef(false);
  const flushQueuedRef = useRef(false);
  // Guards against a job being processed twice, from two different causes
  // seen in the field: (1) a fast double-tap on Check In before the UI has
  // re-rendered to reflect the first tap, and (2) the geofence watcher
  // re-firing an auto check-in because a reload briefly lost track of the
  // job's checked-in status (see recentlyConfirmedRef below) while you were
  // still standing in the zone. checkInLockRef is a plain ref set
  // synchronously — not React state — so it can't lose the race the way
  // checkedInRef (which only updates after a render commits) can.
  const checkInLockRef = useRef({});
  // Tracks which jobs have already had a cascade reschedule applied today,
  // so even if handleCheckIn does get called again for the same job (lock
  // notwithstanding — belt and suspenders), the calendar doesn't get shoved
  // a second time on top of an already-applied shift.
  const cascadedTodayRef = useRef({});
  // Links a job (by normalized id) to the Unpaid Accounts entry it created
  // via the quick job-card toggle, so switching back to "paid" can close
  // out that specific entry. Session-scoped (not persisted) — if the app
  // reloads before you toggle back, the link is lost and the entry just
  // sits in Unpaid Accounts until cleared manually there, same as any
  // other unpaid account.
  const paymentLinkRef = useRef({});
  // A write that's just been confirmed successfully saved can still get
  // silently reverted by a read that lands moments later, if Sheets hasn't
  // caught up to its own write yet (observed: Tin Shed's check-in vanished
  // on a reload ~50s after it was confirmed flushed). pendingStatusRef only
  // protects writes that are still in flight; this remembers writes for a
  // short grace period *after* they're confirmed too, so a read landing in
  // that window still gets reconciled correctly instead of trusting a
  // possibly-stale sheet response.
  const recentlyConfirmedRef = useRef({});
  const RECENT_CONFIRM_GRACE_MS = 90 * 1000;
  const jobsRef = useRef([]);
  const dayStartedRef = useRef(false);
  const dayFinishedRef = useRef(false);
  const accessTokenRef = useRef(accessToken);

  const dbg = (msg, type = "info") => {
    console.log("[TechPortal]", msg);
    if (type !== "error") return;
    const entry = { time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }), msg, type };
    setDebugLog(prev => {
      const next = [entry, ...prev].slice(0, 500);
      try {
        const key = "techportal_debugLog_" + new Date().toDateString();
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // ── Pending-save persistence ────────────────────────────────────────────
  // pendingStatusRef is the in-memory queue of not-yet-saved status writes.
  // Anything sitting only in that ref disappears if the tab is killed or
  // reloaded before a flush succeeds. persistPending() mirrors it into
  // localStorage so a killed session can be rehydrated and retried later.
  const persistPending = () => {
    try {
      const keys = Object.keys(pendingStatusRef.current);
      if (keys.length === 0) localStorage.removeItem(PENDING_SAVES_KEY);
      else localStorage.setItem(PENDING_SAVES_KEY, JSON.stringify(pendingStatusRef.current));
    } catch {}
  };

  const setPending = (key, value) => {
    pendingStatusRef.current[key] = value;
    persistPending();
  };

  const [gpsTrack, setGpsTrack] = useState(() => { try { const k = "gpsTrack_" + new Date().toDateString(); const s = localStorage.getItem(k); return s ? JSON.parse(s) : []; } catch { return []; } });
  const { jobs: rawJobs, loading, error, refresh } = useCalendarJobs(accessToken, selectedDate);
  // Same exclusion list used for the monthly stats — B Shift/Vacation/etc.
  // live on the same calendar as real jobs, so they show up here too
  // unless filtered out the same way.
  const jobs = rawJobs.filter(j => !isNonJobEvent(j.title));

  useEffect(() => { checkedInRef.current = checkedIn; }, [checkedIn]);
  useEffect(() => { mileageLogRef.current = mileageLog; }, [mileageLog]);
  useEffect(() => { gpsTrackRef.current = gpsTrack; }, [gpsTrack]);
  useEffect(() => { completedRef.current = completed; }, [completed]);
  useEffect(() => { checkedOutRef.current = checkedOut; }, [checkedOut]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => { dayStartedRef.current = dayStarted; }, [dayStarted]);
  useEffect(() => { dayFinishedRef.current = dayFinished; }, [dayFinished]);
  useEffect(() => {
    accessTokenRef.current = accessToken;
    if (accessToken) dbg("✅ accessToken updated (" + accessToken.slice(0, 10) + "...)");
    else dbg("⚠️ accessToken is null/undefined", "warn");
  }, [accessToken]);

  useImperativeHandle(ref, () => ({ flushPending: () => flushStatusSaves() }));

  // ── Prune old daily localStorage keys ────────────────────────────────
  // Every day this app has been used, it's created a NEW localStorage key
  // for that day's debug log, GPS track, mileage log, job status cache,
  // and job values — and none of them were ever cleaned up. After months
  // of daily use that can approach or exceed the browser's storage quota,
  // which causes localStorage.setItem to silently fail wherever it's
  // wrapped in a bare try/catch (several places are) — plausible root
  // cause for a debug log that stops capturing mid-day, or general
  // flakiness that clears up with a fresh reload. Runs once per app load;
  // keeps the most recent 14 days, deletes anything older.
  useEffect(() => {
    try {
      const PREFIXES = ["techportal_debugLog_", "gpsTrack_", "mileageLog_", "techportal_jobStatus_", "techportal_jobValues_"];
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14); cutoff.setHours(0, 0, 0, 0);
      let pruned = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        const prefix = PREFIXES.find(p => key.startsWith(p));
        if (!prefix) continue;
        const dateStr = key.slice(prefix.length);
        const d = new Date(dateStr);
        if (!isNaN(d) && d < cutoff) { localStorage.removeItem(key); pruned++; }
      }
      if (pruned > 0) dbg("🧹 Pruned " + pruned + " old localStorage key(s) from before " + cutoff.toDateString());
    } catch (e) {
      console.warn("[TechPortal] localStorage prune failed:", e);
    }
  }, []);

  // Rehydrate any pending saves left over from a killed/reloaded session.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_SAVES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Object.keys(parsed).length > 0) {
          Object.assign(pendingStatusRef.current, parsed);
          dbg("♻️ Rehydrated " + Object.keys(parsed).length + " unsaved pending write(s) from last session", "warn");
        }
      }
    } catch {}
  }, []);

  // As soon as we have a valid token, try to flush anything still pending
  // (rehydrated saves, or saves that were queued while the token was stale).
  useEffect(() => {
    if (accessToken && Object.keys(pendingStatusRef.current).length > 0) {
      flushStatusSaves();
    }
  }, [accessToken]);

  const syncGeofenceDataToSW = () => {
    if (!navigator.serviceWorker?.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: "STORE_GEOFENCE_DATA",
      payload: {
        dayStarted, dayFinished,
        jobs: jobsRef.current.map(j => ({ id: normalizeId(j.id), title: j.title, startTime: j.startTime, location: j.location })),
        jobCoords: jobCoordsRef.current,
        checkedIn: checkedInRef.current,
        completed: completedRef.current,
        accessToken: accessTokenRef.current,
      }
    });
  };

  useEffect(() => {
    if (!dayStarted || dayFinished) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then(p => dbg("🔔 Notification permission: " + p));
    }
    if ("serviceWorker" in navigator && "periodicSync" in (navigator.serviceWorker || {})) {
      navigator.serviceWorker.ready.then(async reg => {
        try {
          await reg.periodicSync.register("geofence-check", { minInterval: 2 * 60 * 1000 });
          dbg("✅ Background periodic sync registered (2 min)");
        } catch (e) { dbg("⚠️ Periodic sync not supported: " + e.message, "warn"); }
      });
    }
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "START_BACKGROUND_GEOFENCE" });
    }
    syncGeofenceDataToSW();
  }, [dayStarted, dayFinished]);

  useEffect(() => { if (dayStarted) syncGeofenceDataToSW(); }, [checkedIn, completed, jobCoordsRef.current]);

  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handler = (event) => {
      if (event.data?.type === "NOTIFICATION_CHECKIN" && event.data.jobId) {
        const job = jobsRef.current.find(j => normalizeId(j.id) === event.data.jobId);
        if (job) handleCheckIn(event.data.jobId, job.title);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  const isToday = new Date().toDateString() === selectedDate.toDateString();
  selectedDateRef.current = selectedDate;
  const displayDate = selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const totalMiles = mileageLog.reduce((sum, m) => sum + m.miles, 0);
  const gpsTrackedMilesRaw = gpsTrack.length >= 2 ? Math.round(gpsTrack.reduce((sum, pt, i) => i === 0 ? 0 : sum + calcMiles(gpsTrack[i-1][0], gpsTrack[i-1][1], pt[0], pt[1]), 0) * 10) / 10 : null;
  // GPS tracking can go quiet for stretches of the day — phone locked,
  // app backgrounded and the OS kills location updates, a permission
  // hiccup — and when that happens this silently undercounts, sometimes
  // drastically (seen firsthand: legs summing to 107 mi while this read
  // 5.7), while still being shown as "Total" directly under a per-leg log
  // that visibly adds up to something much bigger. Each logged leg is its
  // own routed driving-distance estimate between two real addresses, so
  // it stays accurate even when the live GPS trace has gaps — only trust
  // the GPS figure when it's at least in the same ballpark as those legs;
  // otherwise fall back to the summed legs instead of showing a number
  // that visibly contradicts the log right above it.
  const gpsTrackedMiles = (gpsTrackedMilesRaw !== null && totalMiles > 1 && gpsTrackedMilesRaw < totalMiles * 0.5) ? null : gpsTrackedMilesRaw;
  const displayMiles = gpsTrackedMiles !== null ? gpsTrackedMiles : Math.round(totalMiles * 10) / 10;

  // Total revenue: sum of every dollar value entered for today's jobs.
  const totalRevenue = Object.values(jobValues).reduce((sum, v) => sum + (Number(v) || 0), 0);

  // Elapsed day hours: prefer the GPS track span (already recorded every 30s
  // while the day is active, plus a final point on Finish Day) since it's
  // precise epoch-ms data. Fall back to the mileage log's first/last
  // timestamps if GPS data isn't available for some reason.
  let dayHours = null;
  if (gpsTrack.length >= 2) {
    dayHours = (gpsTrack[gpsTrack.length - 1][2] - gpsTrack[0][2]) / 3600000;
  } else if (mileageLog.length >= 2) {
    const firstT = parseClockTime(mileageLog[0].time);
    const lastWithTime = [...mileageLog].reverse().find(m => m.checkOut || m.time);
    const lastT = lastWithTime ? parseClockTime(lastWithTime.checkOut || lastWithTime.time) : null;
    if (firstT && lastT) dayHours = (lastT - firstT) / 3600000;
  }
  const hourlyRate = dayHours && dayHours > 0.01 ? totalRevenue / dayHours : null;

  const monthName = selectedDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const now = new Date();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  // Previously this used two different definitions of "done" — the
  // number came from app-state (Object.keys(completed)) plus a
  // date-based "pastEvents" count, while the modal lists filtered
  // purely by calendar time. Those disagreed constantly (e.g. a job
  // whose time passed today but was never marked complete). Now both
  // the numbers AND the lists come from the exact same source:
  // monthCompletedIds (built from a full sheet scan — see
  // loadJobStatuses) merged with today's live local `completed` state
  // for anything not yet flushed to the sheet.
  const isEventDone = (e) => {
    const nid = normalizeId(e.id);
    return monthCompletedIds.has(nid) || !!completed[nid];
  };
  const completedEvents = monthlyEvents.filter(isEventDone);
  const remainingEvents = monthlyEvents.filter((e) => !isEventDone(e));
  const totalCompleted = completedEvents.length;
  const remaining = monthlyCount !== null ? remainingEvents.length : null;

  useEffect(() => {
    if (!navigator.geolocation) { setLocationError("GPS not supported."); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        locationRef.current = c;
        setLocation(c);
        setLocationError(null);
        const accuracyM = pos.coords.accuracy || 9999;
        // Readings worse than the hard cutoff are unusable for any distance
        // math (the accuracy circle is bigger than a city block) — always
        // skip AND always log (no more 10% random sampling), so a repeat of
        // an indoor-GPS miss is diagnosable from the debug log in real time
        // instead of guessed at after the fact.
        if (accuracyM > GEOFENCE_HARD_ACCURACY_CUTOFF_M) {
          dbg("⚠️ Skipping geofence — accuracy " + Math.round(accuracyM) + "m too low (cutoff " + GEOFENCE_HARD_ACCURACY_CUTOFF_M + "m)", "warn");
          return;
        }
        const dayStartedNow = dayStartedRef.current;
        const dayFinishedNow = dayFinishedRef.current;
        if (!dayStartedNow || dayFinishedNow) return;
        const currentJobs = jobsRef.current;
        const currentCheckedIn = checkedInRef.current;
        const currentCompleted = completedRef.current;
        const checkedOutRef_current = checkedOutRef.current;
        const nowMs = Date.now();
        // Miles-equivalent of this reading's accuracy circle, used to
        // compensate the distance check below — a noisy indoor reading
        // (e.g. 300m accuracy in a mall) can still legitimately place you
        // inside the geofence even if the raw point estimate lands outside it.
        const accuracyMiles = accuracyM / 1609.344;
        currentJobs.forEach(async (job) => {
          const nid = normalizeId(job.id);
          const isCheckedIn = currentCheckedIn[nid];
          const isCheckedOut = checkedOutRef_current[nid];
          const isCompleted = currentCompleted[nid];
          const coords = jobCoordsRef.current[nid];
          if (!coords) {
            if (!isCheckedIn && !isCompleted && Math.random() < 0.05) dbg("⚠️ No coords cached yet for: " + job.title, "warn");
            return;
          }
          const dist = calcMiles(c.lat, c.lng, coords.lat, coords.lng);
          // Accuracy-compensated distance: subtract the accuracy radius
          // before comparing against the geofence, instead of requiring the
          // raw point estimate alone to land inside GEOFENCE_RADIUS_MILES.
          const effectiveDist = Math.max(0, dist - accuracyMiles);
          const inZone = effectiveDist <= GEOFENCE_RADIUS_MILES;
          if (accuracyM > 150 && !isCheckedIn && !isCompleted && Math.random() < 0.15) {
            dbg("📶 Noisy reading (" + Math.round(accuracyM) + "m accuracy) near " + job.title + " — raw " + Math.round(dist * 5280) + "ft, accuracy-adjusted " + Math.round(effectiveDist * 5280) + "ft", "warn");
          }
          if (!isCheckedIn && !isCompleted) {
            if (inZone) {
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
          }
          if (isCheckedIn && !isCheckedOut && !isCompleted) {
            if (!inZone) {
              if (!departureDwellRef.current[nid]) {
                departureDwellRef.current[nid] = nowMs;
                dbg("🚗 Left " + job.title + " zone — waiting to auto check-out...");
              } else if (nowMs - departureDwellRef.current[nid] >= 60 * 1000) {
                delete departureDwellRef.current[nid];
                dbg("🚪 Auto check-out: " + job.title);
                handleCheckOut(nid, job.title, true);
              }
            } else {
              if (departureDwellRef.current[nid]) {
                delete departureDwellRef.current[nid];
                dbg("↩ Back in zone: " + job.title + " — cancelled auto check-out");
              }
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
    setCheckedIn({}); setCheckedOut({}); setCompleted({}); setNavStart({}); setJobValues({}); setPaymentStatus({});
    setDayStarted(false); setDayFinished(false); setDayStatus(""); setPastDayStatus(""); setStatusLoading(true);
    jobCoordsRef.current = {}; geofenceDwellRef.current = {}; departureDwellRef.current = {}; setGeofenceStatus({});
    checkInLockRef.current = {}; cascadedTodayRef.current = {}; paymentLinkRef.current = {};
    if (new Date().toDateString() !== selectedDate.toDateString()) { try { localStorage.removeItem("techportal_lastPos"); } catch {} lastPositionRef.current = null; }
    try { const ck = JOB_STATUS_CACHE_KEY + selectedDate.toDateString(); const c = localStorage.getItem(ck); if (c) { const { checkedIn: ci, checkedOut: co, completed: comp, invoiced: inv } = JSON.parse(c); if (ci) setCheckedIn(ci); if (co) setCheckedOut(co); if (comp) setCompleted(comp); if (inv) setInvoicedJobs(inv); } } catch {}
    try { const k = "techportal_jobValues_" + selectedDate.toDateString(); const s = localStorage.getItem(k); setJobValues(s ? JSON.parse(s) : {}); } catch { setJobValues({}); }
    try { const k = "mileageLog_" + selectedDate.toDateString(); const s = localStorage.getItem(k); setMileageLog(s ? JSON.parse(s) : []); } catch { setMileageLog([]); }
    try { const k = "gpsTrack_" + selectedDate.toDateString(); const s = localStorage.getItem(k); setGpsTrack(s ? JSON.parse(s) : []); } catch { setGpsTrack([]); }
  }, [selectedDate]);

  useEffect(() => { if (!accessToken) return; fetchMonthlyCount(accessToken); }, [accessToken, selectedDate]);
  useEffect(() => {
    if (!accessToken || arLoadedRef.current) return;
    arLoadedRef.current = true;
    loadARAccounts();
  }, [accessToken]);
  useEffect(() => {
    if (!accessToken || clientSitesLoadedRef.current) return;
    clientSitesLoadedRef.current = true;
    loadClientWebsites();
  }, [accessToken]);
  useEffect(() => { if (!accessToken || loading) return; loadJobStatuses(); }, [accessToken, selectedDate, loading]);
  // Gated on `loading` flipping to false rather than on `jobs` itself —
  // `jobs` is a new array reference every render, which would otherwise
  // re-fire this on every unrelated state change instead of once per
  // day's worth of jobs actually loading in.
  useEffect(() => {
    if (!accessToken || loading || !clientSitesLoadedRef.current) return;
    jobs.forEach(job => { if (job.location) autoLookupWebsite(job); });
  }, [accessToken, loading, selectedDate]);

  useEffect(() => {
    if (!jobs.length || !dayStarted || !isToday) return;
    dbg("🗺️ Geocoding " + jobs.length + " job addresses...");
    jobs.forEach(async (job) => {
      const nid = normalizeId(job.id);
      if (!job.location) { dbg("⚠️ No location for: " + job.title, "warn"); return; }
      if (jobCoordsRef.current[nid]) return;
      const coords = await geocodeAddress(job.location, dbg);
      if (coords) {
        jobCoordsRef.current[nid] = coords;
        dbg("📌 Geocoded: " + job.title + " → " + coords.lat.toFixed(4) + "," + coords.lng.toFixed(4));
        syncGeofenceDataToSW();
      } else {
        dbg("❌ Geocode failed: " + job.title + " (" + job.location + ")", "error");
      }
    });
  }, [jobs, dayStarted, isToday]);

  useEffect(() => {
    if (trackIntervalRef.current) clearInterval(trackIntervalRef.current);
    if (!dayStarted || dayFinished || !isToday) return;
    trackIntervalRef.current = setInterval(() => {
      const pos = locationRef.current;
      if (!pos || pos.accuracy > 300) return;
      setGpsTrack(prev => {
        if (prev.length > 0) { const last = prev[prev.length - 1]; if (calcMiles(last[0], last[1], pos.lat, pos.lng) < 0.01) return prev; }
        const next = [...prev, [parseFloat(pos.lat.toFixed(5)), parseFloat(pos.lng.toFixed(5)), Date.now()]];
        try { localStorage.setItem("gpsTrack_" + new Date().toDateString(), JSON.stringify(next)); } catch {}
        setPending("__GPS_TRACK__", { status: "gpsTrack", extra: JSON.stringify(next) });
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
      setPending("__MILEAGE_LOG__", { status: "mileageLog", extra: JSON.stringify(next) });
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
      const unique = Array.from(new Map(allEvents.map((e) => [e.id, e])).values()).filter(e => !isNonJobEvent(e.summary));
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

  const ensureARTab = async (sheetId) => {
    const token = accessTokenRef.current;
    const infoRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "?fields=sheets.properties", { headers: { Authorization: "Bearer " + token } });
    const info = await infoRes.json();
    const hasTab = (info.sheets || []).find(s => s.properties.title === AR_SHEET_NAME);
    if (!hasTab) {
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: AR_SHEET_NAME } } }] }) });
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A1:E1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [["ID", "Name", "Amount", "Date Added", "Paid"]] }) });
    }
  };

  const ensureClientSitesTab = async (sheetId) => {
    const token = accessTokenRef.current;
    const infoRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "?fields=sheets.properties", { headers: { Authorization: "Bearer " + token } });
    const info = await infoRes.json();
    const hasTab = (info.sheets || []).find(s => s.properties.title === CLIENT_SITES_SHEET_NAME);
    if (!hasTab) {
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CLIENT_SITES_SHEET_NAME } } }] }) });
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + CLIENT_SITES_SHEET_NAME + "'!A1:C1?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [["Client Key", "Client Name", "Website"]] }) });
    }
  };

  // ── Accounts Receivable ──────────────────────────────────────────────
  // Unlike mileage/jobValues (scoped to selectedDate), unpaid accounts carry
  // over across days until settled — so this loads once per session rather
  // than re-fetching on every day change, and lives in its own sheet tab.
  const loadARAccounts = async () => {
    const token = accessTokenRef.current;
    if (!token) return;
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) return;
      await ensureARTab(sheetId);
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A:E", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { dbg("❌ AR sheet read failed: " + res.status, "error"); return; }
      const data = await res.json();
      const rows = data.values || [];
      // Some older test/legacy rows predate the ID column entirely, so
      // several can share an identical (or blank) value in column A —
      // matching purely by "id" can't tell those apart. _sheetRow (the
      // row's actual 1-indexed position in the sheet) always uniquely
      // identifies a specific row regardless of duplicate content, and is
      // what delete/edit/markPaid now use directly instead of re-searching
      // by id.
      const accounts = [];
      rows.forEach((r, i) => {
        if (i === 0) return; // header row
        if (!r[0] || r[4] === "Yes") return; // blank/paid — not a candidate
        const sheetRow = i + 1;
        accounts.push({ id: r[0], name: r[1] || "Untitled", amount: parseFloat(r[2]) || 0, dateAdded: r[3] || "", _sheetRow: sheetRow, _key: "row_" + sheetRow });
      });
      setUnpaidAccounts(accounts);
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(accounts)); } catch {}
      dbg("💳 Loaded " + accounts.length + " unpaid account(s)");
    } catch (e) {
      dbg("❌ loadARAccounts error: " + e.message, "error");
    }
  };

  const saveARAccountRow = async (account, isUpdate) => {
    const token = accessTokenRef.current;
    if (!token) return;
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) return;
      const row = [account.id, account.name, String(account.amount), account.dateAdded, account.paid ? "Yes" : ""];
      if (isUpdate && account._sheetRow) {
        // Known exact position from the last load — write straight there,
        // no re-search needed (and no ambiguity from duplicate content).
        await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A" + account._sheetRow + ":E" + account._sheetRow + "?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
      } else if (isUpdate) {
        // No known row position — this is an account added earlier this
        // session and not yet reloaded. Its id is a freshly-generated
        // "ar_<timestamp>" and is genuinely unique, so searching by id is
        // still safe here (unlike the legacy rows this doesn't apply to).
        const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A:E", { headers: { Authorization: "Bearer " + token } });
        const data = await res.json();
        const rows = data.values || [];
        const idx = rows.findIndex(r => r[0] === account.id);
        if (idx === -1) {
          await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
          return;
        }
        await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A" + (idx + 1) + ":E" + (idx + 1) + "?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
      } else {
        await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A:E:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
      }
    } catch (e) {
      dbg("❌ AR save failed for " + account.name + ": " + e.message, "error");
    }
  };

  // ── Client websites (job-card logos) ────────────────────────────────────
  // Cleaned/lowercased title, not the raw calendar summary — so the same
  // client matches across recurring visits even though each visit is a
  // different calendar event id.
  const clientKeyFor = (title) => (title || "").replace(/^(⚠️ MISSED - )+/, "").trim().toLowerCase();

  const loadClientWebsites = async () => {
    const token = accessTokenRef.current;
    if (!token) return;
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) return;
      await ensureClientSitesTab(sheetId);
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + CLIENT_SITES_SHEET_NAME + "'!A:C", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { dbg("❌ Client sites read failed: " + res.status, "error"); return; }
      const data = await res.json();
      const rows = data.values || [];
      const sites = {};
      rows.forEach((r, i) => {
        if (i === 0 || !r[0]) return; // header / blank key
        sites[r[0]] = { name: r[1] || "", website: r[2] || "", _sheetRow: i + 1 };
      });
      setClientWebsites(sites);
      try { localStorage.setItem("techportal_clientWebsites", JSON.stringify(sites)); } catch {}
      dbg("🌐 Loaded " + Object.keys(sites).length + " client website(s)");
    } catch (e) {
      dbg("❌ loadClientWebsites error: " + e.message, "error");
    }
  };

  const saveClientWebsite = async (clientKey, clientName, website) => {
    const token = accessTokenRef.current;
    if (!token || !clientKey) return;
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) return;
      const row = [clientKey, clientName, website];
      let sheetRow = clientWebsites[clientKey]?._sheetRow;
      if (!sheetRow) {
        // Not yet known this session (new client, or added earlier this
        // session but not reloaded) — search by key so a second edit before
        // the next load doesn't append a duplicate row.
        const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + CLIENT_SITES_SHEET_NAME + "'!A:C", { headers: { Authorization: "Bearer " + token } });
        const data = await res.json();
        const idx = (data.values || []).findIndex(r => r[0] === clientKey);
        if (idx !== -1) sheetRow = idx + 1;
      }
      if (sheetRow) {
        await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + CLIENT_SITES_SHEET_NAME + "'!A" + sheetRow + ":C" + sheetRow + "?valueInputOption=USER_ENTERED", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
      } else {
        await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + CLIENT_SITES_SHEET_NAME + "'!A:C:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: [row] }) });
      }
      setClientWebsites(prev => {
        const next = { ...prev, [clientKey]: { name: clientName, website, _sheetRow: sheetRow } };
        try { localStorage.setItem("techportal_clientWebsites", JSON.stringify(next)); } catch {}
        return next;
      });
      dbg("🌐 Saved website for " + clientName + ": " + website);
    } catch (e) {
      dbg("❌ saveClientWebsite failed for " + clientName + ": " + e.message, "error");
    }
  };

  // Auto-discovers a client's website via api/places.js (Google Places —
  // business name + address in, website out) instead of requiring it be
  // typed in by hand. Only runs once per client key: a null/empty result
  // gets cached the same as a found one (so a client with no website isn't
  // re-queried every day) UNLESS the lookup itself failed (network error or
  // a non-OK Places status, e.g. Places API not enabled yet) — those are
  // deliberately left unsaved so they retry on the next fresh load instead
  // of permanently caching a bad "no website" answer from a config problem.
  const autoLookupWebsite = async (job) => {
    const key = clientKeyFor(job.title);
    if (!key || !job.location) return;
    if (clientWebsites[key] !== undefined) return; // already have an answer
    if (websiteLookupAttemptedRef.current[key]) return; // already tried this session
    websiteLookupAttemptedRef.current[key] = true;
    const cleanTitle = job.title.replace(/^(⚠️ MISSED - )+/, "").trim();
    try {
      const res = await fetch("/api/places?query=" + encodeURIComponent(cleanTitle + " " + job.location));
      const data = await res.json();
      if (!res.ok || data.error) { dbg("❌ Website lookup failed for " + cleanTitle + ": " + (data.error || res.status), "error"); return; }
      const website = data.website || "";
      await saveClientWebsite(key, cleanTitle, website);
      dbg(website ? "🌐 Auto-found website for " + cleanTitle + ": " + website : "🌐 No website found for " + cleanTitle);
    } catch (e) {
      dbg("❌ Website auto-lookup error for " + cleanTitle + ": " + e.message, "error");
    }
  };

  // Pulls from monthlyEvents — the whole current month's calendar events,
  // already fetched for the "completed/remaining this month" stats at the
  // top — instead of just whichever single day happens to be selected. So a
  // job from last week is just as reachable as one from today, with no
  // extra API calls since this data's already loaded. Only jobs that have
  // already ended are candidates — a job still scheduled for later isn't
  // "unpaid" yet, it just hasn't happened.
  const arCandidates = [...monthlyEvents]
    .filter(e => {
      if (!e.start?.dateTime && !e.start?.date) return false;
      const end = new Date(e.end?.dateTime || e.end?.date);
      return !isNaN(end) && end < now;
    })
    .sort((a, b) => new Date(b.start?.dateTime || b.start?.date) - new Date(a.start?.dateTime || a.start?.date));

  const handleAddUnpaidAccountFromJob = () => setArPicker({ step: "pick" });

  const handlePickArJob = (event) => {
    const nid = normalizeId(event.id);
    const cleanTitle = (event.summary || "Untitled").replace(/^(⚠️ MISSED - )+/, "");
    // If this job happens to be from the day currently loaded, its $ value
    // might already be in jobValues — prefill it so there's less to retype.
    const existingVal = jobValues[nid];
    setArAmountInput(existingVal != null ? String(existingVal) : "");
    setArPicker({ step: "amount", title: cleanTitle });
  };

  const handleConfirmArAmount = () => {
    const amount = parseFloat(arAmountInput.trim());
    if (isNaN(amount) || amount <= 0) { alert("Enter a valid dollar amount (e.g. 150 or 150.50)."); return; }
    const id = "ar_" + Date.now();
    const account = {
      id,
      name: arPicker.title,
      amount,
      dateAdded: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      _key: id, // freshly generated id is genuinely unique — safe to use directly
    };
    setUnpaidAccounts(prev => {
      const next = [...prev, account];
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow(account, false);
    dbg("💳 Added unpaid account: " + account.name + " — $" + amount);
    setArPicker(null);
    setArAmountInput("");
  };

  const handleAddUnpaidAccount = () => {
    const name = prompt("Customer / account name:");
    if (!name || !name.trim()) return;
    const amountStr = prompt("Amount owed for " + name.trim() + " ($):");
    if (amountStr === null) return;
    const amount = parseFloat(amountStr.trim());
    if (isNaN(amount) || amount <= 0) { alert("Enter a valid dollar amount (e.g. 150 or 150.50)."); return; }
    const id = "ar_" + Date.now();
    const account = {
      id,
      name: name.trim(),
      amount,
      dateAdded: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      _key: id,
    };
    setUnpaidAccounts(prev => {
      const next = [...prev, account];
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow(account, false);
    dbg("💳 Added unpaid account: " + account.name + " — $" + amount);
  };

  const handleEditUnpaidAccount = (key) => {
    const account = unpaidAccounts.find(a => a._key === key);
    if (!account) return;
    const input = prompt("Amount owed for " + account.name + " ($):", String(account.amount));
    if (input === null) return;
    const amount = parseFloat(input.trim());
    if (isNaN(amount) || amount < 0) { alert("Enter a valid dollar amount."); return; }
    const updated = { ...account, amount };
    setUnpaidAccounts(prev => {
      const next = prev.map(a => a._key === key ? updated : a);
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow(updated, true);
    dbg("💳 Updated unpaid account: " + account.name + " → $" + amount);
  };

  // Deterministic per account — same invoice number every time you reopen
  // the Send Invoice prompt (e.g. to resend), derived from the account's
  // own id (already unique) rather than today's date, so it doesn't shift
  // if you resend on a different day than you first created the entry.
  const invoiceNumberFor = (account) => {
    if (account.invoiceNumber) return account.invoiceNumber;
    const digits = String(account.id || account._key || "").replace(/\D/g, "");
    return "INV-" + (digits.slice(-8) || Date.now().toString().slice(-8));
  };

  const handleOpenInvoicePrompt = (key) => {
    const account = unpaidAccounts.find(a => a._key === key);
    if (!account) return;
    if (!account.invoiceNumber) {
      const updated = { ...account, invoiceNumber: invoiceNumberFor(account) };
      setUnpaidAccounts(prev => {
        const next = prev.map(a => a._key === key ? updated : a);
        try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
        return next;
      });
    }
    setInvoiceEmailInput(account.email || "");
    setInvoiceEmailPrompt({ key });
  };

  // Builds a pre-filled mailto: link and hands it to the phone/computer's
  // own mail app to actually send — no email-sending backend required.
  // Includes the invoice # in both the Square payment line and the check
  // memo instructions so a payment can be matched back to this invoice
  // either way.
  const handleSendInvoice = () => {
    if (!invoiceEmailPrompt) return;
    const email = invoiceEmailInput.trim();
    if (!email || !email.includes("@")) { alert("Enter a valid email address."); return; }
    const key = invoiceEmailPrompt.key;
    const account = unpaidAccounts.find(a => a._key === key);
    if (!account) { setInvoiceEmailPrompt(null); return; }
    const invoiceNumber = account.invoiceNumber || invoiceNumberFor(account);
    const updated = { ...account, email, invoiceNumber };
    setUnpaidAccounts(prev => {
      const next = prev.map(a => a._key === key ? updated : a);
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow(updated, true);

    const amountStr = "$" + account.amount.toFixed(2);
    const subject = "Invoice " + invoiceNumber + " from " + INVOICE_BUSINESS.name;
    const body = [
      "Hi " + account.name + ",",
      "",
      "Here's your invoice for beer line cleaning service.",
      "",
      "Invoice #: " + invoiceNumber,
      "Amount due: " + amountStr,
      "",
      "Pay online by card:",
      INVOICE_SQUARE_PAY_URL,
      "(enter invoice #" + invoiceNumber + " when prompted so it's matched to this invoice)",
      "",
      "Or mail a check to:",
      INVOICE_BUSINESS.name,
      INVOICE_BUSINESS.addr1,
      INVOICE_BUSINESS.addr2,
      "(please write invoice #" + invoiceNumber + " on the memo line)",
      "",
      "Thanks for your business!",
      INVOICE_BUSINESS.name,
      INVOICE_BUSINESS.phone,
    ].join("\n");

    const mailto = "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    window.location.href = mailto;
    dbg("✉️ Invoice mailto opened for " + account.name + " — " + invoiceNumber);
    setInvoiceEmailPrompt(null);
    setInvoiceEmailInput("");
  };

  const handleMarkPaid = (key) => {
    const account = unpaidAccounts.find(a => a._key === key);
    if (!account) return;
    if (!confirm(account.name + " — mark $" + account.amount.toFixed(2) + " as paid?")) return;
    setUnpaidAccounts(prev => {
      const next = prev.filter(a => a._key !== key);
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow({ ...account, paid: true }, true);
    dbg("💳 Marked paid: " + account.name);
  };

  // Distinct from handleMarkPaid: "Paid" is for real accounts that actually
  // got settled — it leaves a permanent Paid:Yes row in the sheet as a
  // record. Delete is for entries that shouldn't have existed at all (test
  // data, mistakes) — it removes the row entirely rather than leaving a
  // fake "paid" record behind.
  //
  // Uses _sheetRow directly (the row's exact position, captured at load
  // time) rather than re-searching the sheet by id — some legacy rows
  // predate the ID column and share identical/blank values there, so an
  // id-based search couldn't reliably tell them apart. Falls back to an
  // id search only for accounts added this session that haven't been
  // reloaded yet (their id is freshly generated and genuinely unique, so
  // that fallback is safe).
  const handleDeleteUnpaidAccount = async (key) => {
    const account = unpaidAccounts.find(a => a._key === key);
    if (!account) return;
    if (!confirm("Delete \"" + account.name + "\" ($" + account.amount.toFixed(2) + ")? This removes it entirely — not the same as marking it paid.")) return;
    setUnpaidAccounts(prev => {
      const next = prev
        .filter(a => a._key !== key)
        // Deleting a sheet row shifts every row below it up by one — keep
        // locally-cached row positions in sync so a second delete this
        // same session (before any reload) still targets the right row.
        .map(a => (account._sheetRow && a._sheetRow && a._sheetRow > account._sheetRow) ? { ...a, _sheetRow: a._sheetRow - 1 } : a);
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    try {
      const token = accessTokenRef.current;
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId || !token) return;
      const infoRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "?fields=sheets.properties", { headers: { Authorization: "Bearer " + token } });
      const info = await infoRes.json();
      const tab = (info.sheets || []).find(s => s.properties.title === AR_SHEET_NAME);
      if (!tab) return;
      let targetRow = account._sheetRow;
      if (!targetRow) {
        const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + AR_SHEET_NAME + "'!A:E", { headers: { Authorization: "Bearer " + token } });
        const data = await res.json();
        const rows = data.values || [];
        const idx = rows.findIndex(r => r[0] === account.id);
        if (idx === -1) { dbg("⚠️ Delete: row for " + account.name + " not found in sheet", "warn"); return; }
        targetRow = idx + 1;
      }
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow } } }] }),
      });
      dbg("🗑️ Deleted unpaid account: " + account.name);
    } catch (e) {
      dbg("❌ Delete failed for " + account.name + ": " + e.message, "error");
    }
  };

  const loadJobStatuses = async (isRetry = false) => {
    if (loadingStatusesRef.current && !isRetry) {
      dbg("⏭️ Skipped overlapping loadJobStatuses call (already in progress)", "warn");
      return;
    }
    loadingStatusesRef.current = true;
    const token = accessTokenRef.current;
    setStatusLoading(true);
    dbg("📥 Loading job statuses...");
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) { setStatusLoading(false); loadingStatusesRef.current = false; return; }
      await ensureStatusTab(sheetId);
      const dateKey = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) { dbg("❌ Sheets read failed: " + res.status, "error"); localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); loadingStatusesRef.current = false; return; }
      const data = await res.json();
      const rows = data.values || [];
      const todayRows = rows.filter(r => r[0] === dateKey);
      dbg("📊 Loaded " + todayRows.length + " rows for " + dateKey);

      // Month-to-date miles — reuses this same fetch (no extra API call).
      // Group every row by its date, and for each date in the current
      // month, compute that day's total the same way displayMiles does
      // (GPS track distance when available, else summed mileage legs),
      // then add up across all days. Also builds monthCompletedIds — the
      // single source of truth for which jobs are actually done this
      // month, used by both the "completed/remaining" numbers and their
      // modal lists so they can't disagree with each other anymore.
      try {
        const rowsByDate = {};
        rows.forEach(r => { if (r[0]) (rowsByDate[r[0]] = rowsByDate[r[0]] || []).push(r); });
        const curMonth = selectedDate.getMonth();
        const curYear = selectedDate.getFullYear();
        let monthTotal = 0;
        const doneIds = new Set();
        Object.entries(rowsByDate).forEach(([dStr, dRows]) => {
          const parsed = new Date(dStr);
          if (isNaN(parsed) || parsed.getMonth() !== curMonth || parsed.getFullYear() !== curYear) return;
          const gRow = dRows.find(r => r[1] === "__GPS_TRACK__");
          const mRow = dRows.find(r => r[1] === "__MILEAGE_LOG__");
          let dayMiles = 0;
          if (gRow) {
            try {
              const track = JSON.parse(gRow[3]);
              if (Array.isArray(track) && track.length >= 2) {
                dayMiles = track.reduce((sum, pt, i) => i === 0 ? 0 : sum + calcMiles(track[i - 1][0], track[i - 1][1], pt[0], pt[1]), 0);
              }
            } catch {}
          }
          if (dayMiles === 0 && mRow) {
            try {
              const log = JSON.parse(mRow[3]);
              if (Array.isArray(log)) dayMiles = log.reduce((s, m) => s + (m.miles || 0), 0);
            } catch {}
          }
          monthTotal += dayMiles;
          dRows.forEach(r => {
            const jobId = r[1];
            const status = r[2];
            if (jobId && jobId.endsWith("__done") && (status === "completed" || status === "missed")) {
              doneIds.add(normalizeId(jobId.slice(0, -6)));
            }
          });
        });
        setMonthlyMiles(Math.round(monthTotal * 10) / 10);
        setMonthCompletedIds(doneIds);
      } catch (e) {
        dbg("❌ Monthly mileage calc error: " + e.message, "error");
      }

      if (rows.length <= 1 && !isRetry && localStorage.getItem("techportal_logSheetId")) {
        localStorage.removeItem("techportal_logSheetId"); setLogSheetId(null); setStatusLoading(false); loadingStatusesRef.current = false; loadJobStatuses(true); return;
      }
      const newCI = {}; const newCO = {}; const newComp = {}; const newInv = {}; const newValues = {}; const newPaymentStatus = {}; const newPaymentMethod = {};
      let loadedStarted = false; let loadedFinished = false; let loadedStatus = "";
      let lastMileageRow = null; let lastGpsRow = null;
      todayRows.forEach(row => { if (row[1] === "__MILEAGE_LOG__") lastMileageRow = row; if (row[1] === "__GPS_TRACK__") lastGpsRow = row; });
      // ── Stale-read guard: mileageLog / gpsTrack ──────────────────────────
      // A sheet read can race a not-yet-flushed local write (e.g. a token
      // refresh reload firing right after a mileage leg was added locally
      // but before it synced). Accepting the fetched array unconditionally
      // in that case silently reverts local progress. Skip the overwrite
      // if that key still has a pending save queued, or if the fetched
      // array is shorter than what's already loaded locally — a real sync
      // should only ever grow these arrays, never shrink them.
      const mileagePending = !!pendingStatusRef.current["__MILEAGE_LOG__"];
      const gpsPending = !!pendingStatusRef.current["__GPS_TRACK__"];
      if (lastMileageRow && !mileagePending) {
        try {
          const log = JSON.parse(lastMileageRow[3]);
          if (Array.isArray(log) && log.length >= mileageLogRef.current.length) setMileageLog(log);
          else if (Array.isArray(log) && log.length > 0) dbg("⚠️ Skipped stale mileage-log read (" + log.length + " legs vs " + mileageLogRef.current.length + " local)", "warn");
        } catch {}
      }
      if (lastGpsRow && !gpsPending) {
        try {
          const track = JSON.parse(lastGpsRow[3]);
          if (Array.isArray(track) && track.length >= gpsTrackRef.current.length) setGpsTrack(track);
          else if (Array.isArray(track) && track.length > 0) dbg("⚠️ Skipped stale GPS-track read (" + track.length + " pts vs " + gpsTrackRef.current.length + " local)", "warn");
        } catch {}
      }
      const missedFromSheet = [];
      todayRows.forEach(row => {
        const [, jobId, status, extra] = row;
        if (jobId === "__DAY_STARTED__") { loadedStarted = true; loadedStatus = "Day started at " + extra; }
        if (jobId === "__DAY_FINISHED__") { if (status !== "unfinished") { loadedStarted = true; loadedFinished = true; loadedStatus = extra; } }
        if (jobId && !jobId.startsWith("__")) {
          const baseId = normalizeId(jobId.replace(/__ci$/, "").replace(/__co$/, "").replace(/__done$/, "").replace(/__invoice$/, "").replace(/__value$/, "").replace(/__paid$/, "").replace(/__method$/, ""));
          if (status === "checkedIn") newCI[baseId] = extra || "—";
          if (status === "checkedOut") newCO[baseId] = extra || "—";
          if (status === "completed") { newComp[baseId] = true; newCI[baseId] = newCI[baseId] || "—"; }
          if (status === "jobValue") { const v = parseFloat(extra); if (!isNaN(v)) newValues[baseId] = v; }
          if (status === "paid" || status === "unpaid") newPaymentStatus[baseId] = status;
          if (status === "cash" || status === "check") newPaymentMethod[baseId] = status;
          // "missed" is its own status value (written by handleMissed) distinct
          // from "completed" — it needs to count as done for job-status
          // purposes too, or the job silently reverts to "Scheduled" on any
          // read that didn't originate from the same browser session.
          if (status === "missed") {
            newComp[baseId] = true;
            const matchedJob = jobsRef.current.find(j => normalizeId(j.id) === baseId);
            if (matchedJob) {
              missedFromSheet.push({ jobId: baseId, jobTitle: extra || matchedJob.title, jobLocation: matchedJob.location, calendarId: matchedJob.calendarId, eventId: matchedJob.id, date: dateKey, missedAt: Date.now() });
            }
          }
          if (status === "invoiced") newInv[baseId] = extra || "";
          if (status === "undone") { delete newCI[baseId]; delete newCO[baseId]; delete newComp[baseId]; delete newPaymentStatus[baseId]; delete newPaymentMethod[baseId]; }
        }
      });
      // ── Stale-read guard: day started/finished ──────────────────────────
      // Same class of bug as the mileage/gps guards above, but this one was
      // missing entirely: __DAY_STARTED__ / __DAY_FINISHED__ are "__"-
      // prefixed keys, so the generic pending-write reconcile loop below
      // (which only walks non-"__" per-job keys) never covers them. If
      // Start Day was tapped but that write hadn't been confirmed to the
      // sheet yet — spotty field cell signal, the app getting reloaded or
      // relaunched mid-shift — this read would come back with no
      // __DAY_STARTED__ row, and dayStarted would silently flip back to
      // false with nothing to restore it. That not only shows the "Start
      // Day" button again mid-shift, it also kills mileage-leg logging and
      // GPS-breadcrumb collection for the rest of the day (both gated on
      // dayStarted), even though check-ins/check-outs keep working fine —
      // those are separate keys already covered by the reconcile loop.
      const dayStartedPending = pendingStatusRef.current["__DAY_STARTED__"] || recentlyConfirmedRef.current["__DAY_STARTED__"]?.entry;
      const dayFinishedPending = pendingStatusRef.current["__DAY_FINISHED__"] || recentlyConfirmedRef.current["__DAY_FINISHED__"]?.entry;
      if (dayStartedPending && dayStartedPending.status === "started") {
        loadedStarted = true;
        if (!loadedStatus) loadedStatus = "Day started at " + (dayStartedPending.extra || "");
      }
      if (dayFinishedPending) {
        if (dayFinishedPending.status !== "unfinished") { loadedStarted = true; loadedFinished = true; loadedStatus = dayFinishedPending.extra || loadedStatus; }
        else loadedFinished = false; // in-flight "resume day" shouldn't get overridden back to finished
      }
      // ── Stale-read guard: check-in / check-out / completed ───────────────
      // Anything still sitting in pendingStatusRef hasn't been confirmed
      // written to the sheet yet, which means it's more recent than
      // whatever this read just fetched. Re-apply those on top so a
      // reload can't clobber a check-in/check-out that's simply still
      // in flight (e.g. mid-retry after a 401).
      //
      // Writes that HAVE already been confirmed can still get silently
      // reverted by a read landing moments later — Sheets doesn't
      // guarantee a values.get right after a values.append/batchUpdate
      // reflects that write yet. recentlyConfirmedRef covers that gap: a
      // write stays "protected" for RECENT_CONFIRM_GRACE_MS after it's
      // confirmed, not just while it's still pending.
      const now2 = Date.now();
      Object.keys(recentlyConfirmedRef.current).forEach((k) => {
        if (now2 - recentlyConfirmedRef.current[k].confirmedAt > RECENT_CONFIRM_GRACE_MS) delete recentlyConfirmedRef.current[k];
      });
      const reconcileEntries = { ...Object.fromEntries(Object.entries(recentlyConfirmedRef.current).map(([k, v]) => [k, v.entry])), ...pendingStatusRef.current };
      let reconciledCount = 0;
      Object.entries(reconcileEntries).forEach(([key, entry]) => {
        if (!entry || key.startsWith("__")) return;
        if (key.endsWith("__ci")) { const id = normalizeId(key.slice(0, -4)); if (entry.status === "checkedIn") { newCI[id] = entry.extra || "—"; reconciledCount++; } if (entry.status === "undone") delete newCI[id]; }
        else if (key.endsWith("__co")) { const id = normalizeId(key.slice(0, -4)); if (entry.status === "checkedOut") { newCO[id] = entry.extra || "—"; reconciledCount++; } if (entry.status === "undone") delete newCO[id]; }
        else if (key.endsWith("__done")) { const id = normalizeId(key.slice(0, -6)); if (entry.status === "completed" || entry.status === "missed") { newComp[id] = true; reconciledCount++; } if (entry.status === "undone") delete newComp[id]; }
        else if (key.endsWith("__value")) { const id = normalizeId(key.slice(0, -7)); const v = parseFloat(entry.extra); if (entry.status === "jobValue" && !isNaN(v)) { newValues[id] = v; reconciledCount++; } }
        else if (key.endsWith("__paid")) { const id = normalizeId(key.slice(0, -6)); if (entry.status === "paid" || entry.status === "unpaid") { newPaymentStatus[id] = entry.status; reconciledCount++; } if (entry.status === "undone") delete newPaymentStatus[id]; }
        else if (key.endsWith("__method")) { const id = normalizeId(key.slice(0, -8)); if (entry.status === "cash" || entry.status === "check") { newPaymentMethod[id] = entry.status; reconciledCount++; } if (entry.status === "undone") delete newPaymentMethod[id]; }
      });
      if (reconciledCount > 0) dbg("♻️ Reconciled " + reconciledCount + " in-flight/recent pending write(s) over sheet read", "warn");
      if (missedFromSheet.length > 0) {
        try {
          const existingMissed = JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]");
          const merged = [...existingMissed.filter(m => !missedFromSheet.find(n => n.jobId === m.jobId)), ...missedFromSheet];
          saveMissedJobs(merged);
          dbg("⚠️ Rebuilt " + missedFromSheet.length + " missed-job entry(ies) from sheet data", "warn");
        } catch {}
      }
      setCheckedIn(newCI); setCheckedOut(newCO); setCompleted(newComp); setInvoicedJobs(newInv); setJobValues(newValues); setPaymentStatus(newPaymentStatus); setPaymentMethod(newPaymentMethod);
      try { const k = "techportal_jobValues_" + selectedDate.toDateString(); localStorage.setItem(k, JSON.stringify(newValues)); } catch {}
      try { const ck = JOB_STATUS_CACHE_KEY + selectedDate.toDateString(); localStorage.setItem(ck, JSON.stringify({ checkedIn: newCI, checkedOut: newCO, completed: newComp, invoiced: newInv })); } catch {}
      if (loadedStarted) { setDayStarted(true); if (!lastPositionRef.current && locationRef.current) setLastPos({ lat: locationRef.current.lat, lng: locationRef.current.lng }); try { const sp = localStorage.getItem("techportal_startPos"); if (sp) startPosRef.current = JSON.parse(sp); } catch {} }
      if (loadedFinished) setDayFinished(true);
      if (loadedStatus) setDayStatus(loadedStatus);
      dbg("✅ Statuses loaded: " + Object.keys(newCI).length + " CI, " + Object.keys(newCO).length + " CO, " + Object.keys(newComp).length + " done");
    } catch (e) { dbg("❌ loadJobStatuses error: " + e.message, "error"); }
    setStatusLoading(false);
    loadingStatusesRef.current = false;
  };

  // ── flushStatusSaves ─────────────────────────────────────────────────────
  // Any path that fails now (a) always re-queues the pending saves back into
  // pendingStatusRef.current (previously two branches — "no sheet ID" and
  // "catch after 3 retries" — dropped them entirely) and (b) persists them
  // to localStorage via requeue(), so a killed/reloaded tab can recover them
  // on next launch instead of losing the write silently.
  // ── Overlapping-flush guard ──────────────────────────────────────────────
  // flushStatusSaves() gets called from many independent places (check-in,
  // check-out, job-value edits, the 30s GPS-track tick, the geocode effect
  // syncing to the service worker, etc). Two calls landing close together
  // both read the sheet before either had appended, so both independently
  // decided "this key doesn't exist yet" and both appended it — duplicate
  // rows for the same save. If a flush is already running, queue a follow-up
  // instead of starting a second one in parallel; the follow-up will pick up
  // whatever's newly pending once the in-flight one finishes.
  const flushStatusSaves = async (retryCount = 0) => {
    if (flushInFlightRef.current) {
      flushQueuedRef.current = true;
      return;
    }
    flushInFlightRef.current = true;
    try {
      await doFlushStatusSaves(retryCount);
    } finally {
      flushInFlightRef.current = false;
      if (flushQueuedRef.current) {
        flushQueuedRef.current = false;
        flushStatusSaves();
      }
    }
  };

  const doFlushStatusSaves = async (retryCount = 0) => {
    const token = accessTokenRef.current;
    const pending = { ...pendingStatusRef.current }; // snapshot only — do NOT clear yet
    if (Object.keys(pending).length === 0) return;
    dbg("💾 Flushing " + Object.keys(pending).length + " pending saves (token: " + (token ? token.slice(0,8) + "..." : "MISSING") + ")");

    // Anything in `pending` stays in pendingStatusRef.current for the entire
    // duration of this attempt (not just on failure). That way, if
    // loadJobStatuses() runs concurrently mid-flush — which the debug log
    // shows can happen, sometimes multiple times per second — its
    // reconciliation step still sees these as in-flight and re-applies them
    // on top of a sheet read that hasn't caught up yet, instead of a stale
    // read silently reverting a tap (e.g. "missed") that's still in transit.
    const clearFlushed = () => {
      const confirmedAt = Date.now();
      Object.entries(pending).forEach(([k, entry]) => {
        delete pendingStatusRef.current[k];
        recentlyConfirmedRef.current[k] = { entry, confirmedAt };
      });
      persistPending();
    };
    const requeue = (scheduleRetry) => {
      persistPending(); // pending values are already still in the ref; just persist the current state
      if (!scheduleRetry) return;
      if (retryCount < 3) {
        setTimeout(() => flushStatusSaves(retryCount + 1), (retryCount + 1) * 2000);
      } else {
        dbg("⛔ Giving up after 3 retries — " + Object.keys(pending).length + " save(s) still pending, will retry on next trigger", "error");
      }
    };

    if (!token) { dbg("❌ No token — aborting flush", "error"); requeue(true); return; }
    try {
      const sheetId = await getOrCreateLogSheet();
      if (!sheetId) { dbg("❌ No sheet ID", "error"); requeue(true); return; }
      const dateKey = selectedDateRef.current.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D", { headers: { Authorization: "Bearer " + token } });
      if (res.status === 401) {
        dbg("⚠️ 401 on flush (retry " + retryCount + ")", "warn");
        requeue(true);
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
        if (!r.ok) { dbg("❌ batchUpdate failed: " + r.status, "error"); requeue(true); return; }
        else dbg("✅ Updated " + updateRequests.length + " rows");
      }
      if (appendRows.length > 0) {
        const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ values: appendRows }) });
        if (!r.ok) { dbg("❌ append failed: " + r.status, "error"); requeue(true); return; }
        else dbg("✅ Appended " + appendRows.length + " rows");
      }
      // Everything for this batch succeeded — clear exactly these keys,
      // preserving anything newer that may have been queued during the flush.
      clearFlushed();
    } catch (e) {
      dbg("❌ flush error: " + e.message, "error");
      requeue(true);
    }
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
      setPending("__GPS_TRACK__", { status: "gpsTrack", extra: JSON.stringify([startPt]) });
    }
    setDayStarted(true);
    setDayStatus("Day started at " + time);
    dbg("🚗 Day started at " + time);
    let startLabel = "Start";
    if (livePos) {
      try {
        const geoRes = await fetch("/api/geocode?" + new URLSearchParams({ latlng: livePos.lat + "," + livePos.lng, result_type: "street_address|sublocality|locality" }));
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results[0]) {
          const parts = geoData.results[0].address_components;
          const streetNum = parts.find(p => p.types.includes("street_number"))?.short_name || "";
          const street = parts.find(p => p.types.includes("route"))?.short_name || "";
          const city = parts.find(p => p.types.includes("locality"))?.short_name || "";
          startLabel = [streetNum, street, city].filter(Boolean).join(" ");
        }
      } catch {}
    }
    saveMileage([{ jobId: "__home__", jobTitle: "🚗 " + startLabel, from: "", miles: 0, time, checkIn: time }]);
    await appendToLog([date, "🚗 Start Day (" + startLabel + ")", time, "0", "", "Departed"]);
    setPending("__DAY_STARTED__", { status: "started", extra: time });
    await flushStatusSaves();
  };

  const handleFinishDay = async () => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || HOME;
    const endPt = [parseFloat(currentPos.lat.toFixed(5)), parseFloat(currentPos.lng.toFixed(5)), Date.now()];
    const nextTrack = [...gpsTrack, endPt];
    try { localStorage.setItem("gpsTrack_" + new Date().toDateString(), JSON.stringify(nextTrack)); } catch {}
    setPending("__GPS_TRACK__", { status: "gpsTrack", extra: JSON.stringify(nextTrack) });
    setGpsTrack(nextTrack);
    // Compute the total from `nextTrack` directly (includes the finish
    // point we just appended) rather than the `gpsTrackedMiles` render
    // variable, which still reflects the track from BEFORE this point was
    // added — setGpsTrack is async, so reading that variable here was
    // always one point behind, which is exactly why the frozen "Total: X
    // mi" text could undercount versus the live total shown elsewhere.
    const gpsTotal = nextTrack.length >= 2
      ? Math.round(nextTrack.reduce((sum, pt, i) => i === 0 ? 0 : sum + calcMiles(nextTrack[i - 1][0], nextTrack[i - 1][1], pt[0], pt[1]), 0) * 10) / 10
      : Math.round(totalMiles * 10) / 10;
    let finishLabel = "Finish";
    if (currentPos) {
      try {
        const geoRes = await fetch("/api/geocode?" + new URLSearchParams({ latlng: currentPos.lat + "," + currentPos.lng, result_type: "street_address|sublocality|locality" }));
        const geoData = await geoRes.json();
        if (geoData.status === "OK" && geoData.results[0]) {
          const parts = geoData.results[0].address_components;
          const streetNum = parts.find(p => p.types.includes("street_number"))?.short_name || "";
          const street = parts.find(p => p.types.includes("route"))?.short_name || "";
          const city = parts.find(p => p.types.includes("locality"))?.short_name || "";
          finishLabel = [streetNum, street, city].filter(Boolean).join(" ") || "Finish";
        }
      } catch {}
    }
    let finishMiles = 0;
    if (lastPositionRef.current) {
      finishMiles = await getDrivingMiles(lastPositionRef.current.lat, lastPositionRef.current.lng, currentPos.lat, currentPos.lng);
      if (finishMiles < 0.05 || finishMiles > 150) finishMiles = 0;
    }
    saveMileage(prev => {
      if (prev.some(m => m.jobId === "__finish__")) return prev; // already has finish leg
      return [...prev, { jobId: "__finish__", jobTitle: "🏁 " + finishLabel, from: prev.length > 0 ? prev[prev.length - 1].jobTitle : "Start", miles: finishMiles, time, checkIn: time }];
    });
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
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "DAY_FINISHED" });
    }
    await appendToLog([date, "🏁 Finish Day (" + finishLabel + ")", time, "", "", "Total day: " + gpsTotal + " mi"]);
    setPending("__DAY_FINISHED__", { status: "finished", extra: status });
    await flushStatusSaves();
  };

  const goToPrevDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); setFilter("All"); };
  const goToNextDay = () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d); setFilter("All"); };
  const goToToday = () => { setSelectedDate(new Date()); setFilter("All"); };
  const handleNavigate = (jobId) => { if (location) setNavStart((prev) => ({ ...prev, [jobId]: { lat: location.lat, lng: location.lng } })); };

  // ── Cascading reschedule ──────────────────────────────────────────────
  // When you check in late (or early), the calendar slot planned for this
  // job no longer matches reality — and neither do the jobs still scheduled
  // after it, since they were all planned assuming this one started on
  // time. This moves the checked-in event to your actual arrival time
  // (keeping its original duration), then shifts every job later today
  // that hasn't started yet by that same delta, so the rest of the day's
  // schedule stays realistic instead of just drifting out of sync as the
  // day goes on. Jobs already checked in or completed are left alone —
  // those reflect what already happened, not a plan.
  const CASCADE_THRESHOLD_MS = 5 * 60 * 1000; // ignore drift under 5 min — not worth rewriting the calendar over

  const shiftCalendarEventTime = async (calendarId, eventId, deltaMs, note, retryCount = 0) => {
    const token = accessTokenRef.current;
    if (!calendarId || !eventId || !token) return null;
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + eventId, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("Fetch failed: " + res.status);
      const event = await res.json();
      const patch = {};
      // Only timed events have a real slot to move — all-day events have no
      // dateTime and are left untouched.
      if (event.start?.dateTime) patch.start = { dateTime: new Date(new Date(event.start.dateTime).getTime() + deltaMs).toISOString(), timeZone: event.start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
      if (event.end?.dateTime) patch.end = { dateTime: new Date(new Date(event.end.dateTime).getTime() + deltaMs).toISOString(), timeZone: event.end.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
      if (!patch.start && !patch.end) return event;
      if (note) {
        const stripped = (event.description || "").replace(/\n?---TechPortal Reschedule---[\s\S]*?---End TechPortal Reschedule---/g, "").trimEnd();
        const block = ["---TechPortal Reschedule---", note, "---End TechPortal Reschedule---"].join("\n");
        patch.description = stripped ? stripped + "\n\n" + block : block;
      }
      const patchRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + eventId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) throw new Error("Patch failed: " + patchRes.status);
      return event;
    } catch (e) {
      // A transient network blip here (the original cause of the Coopers
      // Pub calendar time silently staying wrong) shouldn't permanently
      // strand one event — retry a couple times with backoff before
      // actually giving up and surfacing the error to the caller.
      if (retryCount < 2) {
        await new Promise(r => setTimeout(r, (retryCount + 1) * 2000));
        return shiftCalendarEventTime(calendarId, eventId, deltaMs, note, retryCount + 1);
      }
      throw e;
    }
  };

  // ── Update future occurrences of a repeating job ─────────────────────────
  // When a job that's part of a real Google Calendar recurring series gets
  // checked in at a different time than scheduled, this asks whether to
  // carry that corrected time forward to future weeks too — not just
  // today's instance. Mirrors how Google Calendar's own "this and
  // following events" edit works: the OLD series is truncated to stop the
  // day before this occurrence (so past occurrences are never touched),
  // and a NEW series is created starting today at the corrected time,
  // continuing the same repeat pattern.
  //
  // Known limitation: if the original series had a COUNT (fixed number of
  // occurrences) or an UNTIL end date, the new continuing series drops
  // that limit and repeats with no end date instead — computing the exact
  // remaining count/date correctly would need enumerating past instances,
  // which isn't done here. Worth knowing before confirming on a series
  // that's meant to end at some point.
  const maybeUpdateRecurringSeries = async (job, actualTime, recurringEventId) => {
    const token = accessTokenRef.current;
    const calendarId = job.calendarId;
    try {
      const masterRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + recurringEventId, { headers: { Authorization: "Bearer " + token } });
      if (!masterRes.ok) { dbg("❌ Could not fetch recurring series for " + job.title, "error"); return; }
      const master = await masterRes.json();
      if (!master.recurrence || master.recurrence.length === 0) return; // not actually recurring

      const cleanTitle = job.title.replace(/^(⚠️ MISSED - )+/, "");
      const originalStart = new Date(job.startRaw);
      const timeStr = actualTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const originalTimeStr = originalStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (originalTimeStr === timeStr) return; // nothing meaningfully different to carry forward

      const wants = confirm(cleanTitle + " repeats weekly. Update future occurrences to start at " + timeStr + " (was " + originalTimeStr + ")?\n\nPast occurrences are left as-is.");
      if (!wants) return;

      // Use the actual checked-in instance (not the master template) for
      // duration, so the new series keeps the same length appointment.
      const instanceRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + job.id, { headers: { Authorization: "Bearer " + token } });
      const instance = await instanceRes.json();
      const instanceStart = new Date(instance.start?.dateTime || instance.start?.date);
      const instanceEnd = new Date(instance.end?.dateTime || instance.end?.date);
      const durationMs = instanceEnd - instanceStart;
      const timeZone = instance.start?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const newStart = new Date(originalStart);
      newStart.setHours(actualTime.getHours(), actualTime.getMinutes(), 0, 0);
      const newEnd = new Date(newStart.getTime() + durationMs);

      // 1) Truncate the OLD series to stop before this occurrence.
      // Previously this reconstructed "the day before, 11:59:59 PM local
      // time" and converted that to UTC — fragile, because depending on
      // timezone offset and what time this job normally starts, that
      // conversion can land in the wrong place and fail to fully exclude
      // today, leaving the old series to keep generating an occurrence
      // that overlaps the new one (exactly what happened with Hopkins
      // Legion). Cutting off exactly one minute before this occurrence's
      // own precise start instant needs no local-time reconstruction at
      // all — it's just subtracting milliseconds from an already-correct
      // absolute timestamp, so it can't drift across timezones.
      const untilInstant = new Date(originalStart.getTime() - 60 * 1000);
      const untilStr = untilInstant.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      const oldRule = master.recurrence.find(r => r.startsWith("RRULE")) || master.recurrence[0];
      const truncatedRule = oldRule.replace(/;?UNTIL=[^;]+/i, "").replace(/;?COUNT=[^;]+/i, "") + ";UNTIL=" + untilStr;
      const truncateRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + recurringEventId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ recurrence: [truncatedRule] }),
      });
      if (!truncateRes.ok) { dbg("❌ Could not truncate old series for " + cleanTitle, "error"); return; }

      // 2) Create a NEW series starting today at the corrected time,
      // continuing the same repeat pattern (minus any old end condition —
      // see the known-limitation note above).
      const newRuleBase = oldRule.replace(/;?UNTIL=[^;]+/i, "").replace(/;?COUNT=[^;]+/i, "");
      const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events?sendUpdates=none", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          summary: master.summary,
          description: master.description,
          location: master.location,
          colorId: master.colorId,
          reminders: master.reminders,
          start: { dateTime: newStart.toISOString(), timeZone },
          end: { dateTime: newEnd.toISOString(), timeZone },
          recurrence: [newRuleBase],
        }),
      });
      if (!createRes.ok) { dbg("❌ Failed to create updated recurring series for " + cleanTitle, "error"); return; }
      dbg("🔁 Updated recurring series for " + cleanTitle + " — future occurrences now start at " + timeStr);
      refresh();
    } catch (e) {
      dbg("❌ Recurring series update failed for " + job.title + ": " + e.message, "error");
    }
  };

  const cascadeReschedule = async (job, actualTime) => {
    if (!job?.startRaw) return; // all-day / no scheduled time to compare against
    const nid = normalizeId(job.id);
    if (cascadedTodayRef.current[nid]) {
      dbg("⏭️ Skipping cascade for " + job.title + " — already rescheduled today", "warn");
      return;
    }
    // Read the calendar's CURRENT truth for this job before computing the
    // delta — job.startRaw is local React state and can be stale if an
    // earlier job's cascade already shifted this same event moments ago
    // and the UI hasn't refreshed yet. Computing the delta against a
    // stale (pre-shift) time would then get applied on top of the
    // already-shifted live time by shiftCalendarEventTime (which always
    // refetches live and adds deltaMs to that), silently double-shifting
    // the event. This is exactly what caused Angenos to end up at 8:16 AM
    // on the calendar (11:08 AM check-in, minus the same 172-minute delta
    // applied a second time) instead of the correct 11:08 AM.
    let scheduledStart = new Date(job.startRaw);
    try {
      const token = accessTokenRef.current;
      if (token && job.calendarId) {
        const liveRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, { headers: { Authorization: "Bearer " + token } });
        if (liveRes.ok) {
          const live = await liveRes.json();
          if (live.start?.dateTime) scheduledStart = new Date(live.start.dateTime);
        }
      }
    } catch (e) {
      // Fall back to local job.startRaw below if the live fetch fails —
      // better to cascade off a possibly-stale time than not at all.
    }
    if (isNaN(scheduledStart)) return;
    const deltaMs = actualTime.getTime() - scheduledStart.getTime();
    if (Math.abs(deltaMs) < CASCADE_THRESHOLD_MS) return;
    cascadedTodayRef.current[nid] = true;

    const minutesStr = (deltaMs > 0 ? "+" : "") + Math.round(deltaMs / 60000) + " min";
    dbg("🔄 Checked in " + minutesStr + " vs. planned — updating calendar");

    try {
      const event = await shiftCalendarEventTime(
        job.calendarId, job.id, deltaMs,
        "Originally scheduled " + scheduledStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " — moved to actual check-in time (" + minutesStr + ")"
      );
      // DISABLED as of v1.13.0: this always caused a real duplicate event
      // for TODAY specifically, not just an edge case. The new series'
      // first occurrence was always set to today at the corrected time —
      // but today's instance was already separately modified one line
      // above, so it survives as its own standalone event regardless of
      // the old series' truncation. Confirmed duplicating Rush Creek,
      // Ike's, and Sawatdee Mpls in the same session. A correct version
      // would need the new series to start at the NEXT occurrence instead
      // of today — not implemented here; ask before re-enabling.
      // if (event?.recurringEventId) {
      //   maybeUpdateRecurringSeries(job, actualTime, event.recurringEventId);
      // }
    } catch (e) {
      dbg("❌ Reschedule failed for " + job.title + ": " + e.message, "error");
    }

    // "Following" = scheduled later than this job today, and not already
    // underway or done — those are the only ones a shift is meaningful for.
    const following = jobsRef.current.filter(j => {
      if (!j.startRaw) return false;
      const jid = normalizeId(j.id);
      if (jid === nid) return false;
      const jStart = new Date(j.startRaw);
      if (isNaN(jStart) || jStart <= scheduledStart) return false;
      if (checkedInRef.current[jid] || completedRef.current[jid]) return false;
      return true;
    });

    if (following.length > 0) {
      dbg("🔄 Cascading " + minutesStr + " to " + following.length + " later job(s)");
      for (const j of following) {
        try {
          await shiftCalendarEventTime(j.calendarId, j.id, deltaMs);
        } catch (e) {
          dbg("❌ Cascade failed for " + j.title + ": " + e.message, "error");
        }
      }
    }
    refresh(); // re-pull the calendar so the UI reflects the new times
  };

  const handleCheckIn = async (jobId, jobTitle, auto = false) => {
    // Synchronous guard — set immediately, before any await, so it can't
    // lose the race to a second call landing before React has re-rendered
    // with the first check-in's state (a fast double-tap) or before a
    // reload's stale read has a chance to make the geofence watcher think
    // this job isn't checked in yet when you never actually left the zone.
    if (checkedInRef.current[jobId] || checkInLockRef.current[jobId]) {
      dbg("⏭️ Ignoring check-in for " + jobTitle + " — already checked in" + (auto ? " (auto)" : ""), "warn");
      return;
    }
    checkInLockRef.current[jobId] = true;
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    dbg("📍 Check-in: " + jobTitle + (auto ? " (auto)" : ""));
    setCheckedIn((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    const currentPos = livePos || lastPositionRef.current || startPosRef.current || HOME;
    const accuracyOk = !livePos || livePos.accuracy <= 1000;
    let miles = 0;
    // ── KEY FIX: fall back to startPosRef when lastPos is null ──────────────
    const fromPos = lastPositionRef.current || startPosRef.current;
    // ── STALE-CLOSURE FIX ────────────────────────────────────────────────
    // handleCheckIn is called from two places: JobCard's onClick (re-wired
    // fresh every render — sees current state) and the watchPosition
    // geofence effect (mounted once with a `[]` dep array, so its captured
    // reference to this whole function is frozen at mount time). Reading
    // the plain `dayStarted` state here meant every AUTO check-in silently
    // read `dayStarted = false` forever (its value when the app first
    // mounted, before Start Day was even tapped) — so auto-checked-in jobs
    // never got a mileage leg at all. dayStartedRef.current is a ref, kept
    // current by its own effect, and reads correctly regardless of which
    // closure is calling.
    if (dayStartedRef.current && fromPos && accuracyOk) {
      miles = await getDrivingMiles(fromPos.lat, fromPos.lng, currentPos.lat, currentPos.lng);
      if (miles > 0.05 && miles < 150) {
        saveMileage((prev) => [...prev, { jobId, jobTitle, from: prev.length === 0 ? "Start" : prev[prev.length - 1].jobTitle, miles, time, checkIn: time }]);
        dbg("🛣️ Mileage leg: " + miles + " mi to " + jobTitle);
      } else {
        dbg("⚠️ Mileage skipped for " + jobTitle + " — " + miles + " mi (out of range or 0)", "warn");
      }
    } else if (!auto && navStart[jobId] && livePos && accuracyOk) {
      miles = await getDrivingMiles(navStart[jobId].lat, navStart[jobId].lng, livePos.lat, livePos.lng);
      if (miles > 0.05 && miles < 150) saveMileage((prev) => [...prev, { jobId, jobTitle, from: prev.length === 0 ? "Start" : prev[prev.length - 1].jobTitle, miles, time, checkIn: time }]);
    } else {
      dbg("⚠️ No fromPos for mileage — fromPos=" + (fromPos ? "set" : "null") + " dayStarted=" + dayStartedRef.current, "warn");
    }
    if (livePos) setLastPos({ lat: livePos.lat, lng: livePos.lng });
    await appendToLog([date, jobTitle + (auto ? " (auto)" : ""), time, miles > 0.05 && miles < 150 ? miles : "", invoicedJobs[jobId] ? "Yes" : "No", auto ? "Auto check-in" : ""]);
    setPending(jobId + "__ci", { status: "checkedIn", extra: time });
    flushStatusSaves();
    const job = jobsRef.current.find(j => normalizeId(j.id) === jobId);
    if (job) updateCalendarEvent(job, { checkIn: time }).then(() => cascadeReschedule(job, new Date()));
  };

  const handleCheckOut = async (jobId, jobTitle, auto = false) => {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    dbg("🚪 Check-out: " + jobTitle + (auto ? " (auto)" : ""));
    setCheckedOut((prev) => ({ ...prev, [jobId]: time }));
    const livePos = locationRef.current;
    if (livePos) setLastPos({ lat: livePos.lat, lng: livePos.lng });
    else {
      // Fall back to job's geocoded coords so next check-in has a valid from point
      const job = jobs.find(j => normalizeId(j.id) === jobId);
      const nid = normalizeId(jobId);
      const coords = jobCoordsRef.current[nid];
      if (coords) setLastPos({ lat: coords.lat, lng: coords.lng });
    }
    await appendToLog([date, jobTitle + " (check-out" + (auto ? " auto" : "") + ")", time, "", invoicedJobs[jobId] ? "Yes" : "No", auto ? "Auto check-out" : ""]);
    saveMileage((prev) => prev.map(m => m.jobId === jobId ? { ...m, checkOut: time } : m));
    setPending(jobId + "__co", { status: "checkedOut", extra: time });
    flushStatusSaves();
    // Same stale-closure issue as handleCheckIn: this function is called
    // from the mount-time watchPosition effect for auto check-outs, so
    // reading component state `jobs`/`checkedIn` directly here always saw
    // their mount-time values ([] / {}) — meaning the Calendar event
    // description silently never got updated on an auto check-out. The
    // ref versions are kept current regardless of which closure calls in.
    const job = jobsRef.current.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, { checkIn: checkedInRef.current[jobId], checkOut: time });
  };

  // paymentChoice is "paid" or "awaiting", coming from the job card's
  // Paid/Awaiting Payment picker shown right after tapping Mark complete.
  // Drive Mode's quick "Done" tap has no such picker, so it calls this with
  // no paymentChoice — falls through to "awaiting", the same default
  // completing a job always used before.
  const handleComplete = (jobId, paymentChoice) => {
    const nid = normalizeId(jobId);
    dbg("✅ Complete: " + jobId);
    setCompleted((prev) => ({ ...prev, [jobId]: true }));
    setPending(jobId + "__done", { status: "completed", extra: checkedIn[jobId] || "" });
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    const cleanTitle = (job?.title || "").replace(/^(⚠️ MISSED - )+/, "");
    if (job && job.title !== cleanTitle) {
      unmissCalendarEvent(job, cleanTitle);
      saveMissedJobs(missedJobs.filter(m => m.jobId !== jobId));
    }
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: checkedOut[jobId], completed: true, invoiceUrl: invoicedJobs[jobId] });
    if (paymentChoice === "paid") openPaidPrompt(nid, cleanTitle);
    else markUnpaidStatus(nid, cleanTitle);
  };

  // Strips the "⚠️ MISSED - " prefix back off a calendar event's title
  // once a previously-missed job actually gets completed. This used to be
  // a bare one-shot fetch with no retry and no error logging — a single
  // transient failure (a network blip, a token near expiry) left the
  // calendar event's title permanently stuck with the MISSED prefix, with
  // no visibility that anything had gone wrong: the job would show
  // completed and paid everywhere in the app, but every view that reads
  // the calendar's own title (month view, Today's Earnings) would keep
  // showing it as missed forever. Retries with backoff, same pattern as
  // shiftCalendarEventTime elsewhere in this file, and logs a failure to
  // the debug log instead of swallowing it silently.
  const unmissCalendarEvent = async (job, cleanTitle, retryCount = 0) => {
    const token = accessTokenRef.current;
    if (!job?.calendarId || !job?.id || !token) return;
    try {
      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(job.calendarId) + "/events/" + job.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ summary: cleanTitle }),
      });
      if (!res.ok) throw new Error("Patch failed: " + res.status);
      dbg("✅ Cleared MISSED prefix: " + cleanTitle);
      refresh();
    } catch (e) {
      if (retryCount < 2) {
        setTimeout(() => unmissCalendarEvent(job, cleanTitle, retryCount + 1), (retryCount + 1) * 2000);
      } else {
        dbg("❌ Could not clear MISSED prefix for " + cleanTitle + ": " + e.message, "error");
      }
    }
  };

  const handleUndo = (jobId) => {
    setCompleted((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setCheckedIn((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setCheckedOut((prev) => { const n = { ...prev }; delete n[jobId]; return n; });
    setPaymentStatus((prev) => { const n = { ...prev }; delete n[normalizeId(jobId)]; return n; });
    setPaymentMethod((prev) => { const n = { ...prev }; delete n[normalizeId(jobId)]; return n; });
    saveMileage((prev) => prev.filter((m) => m.jobId !== jobId));
    setPending(jobId + "__ci", { status: "undone", extra: "" });
    setPending(jobId + "__co", { status: "undone", extra: "" });
    setPending(jobId + "__done", { status: "undone", extra: "" });
    setPending(jobId + "__paid", { status: "undone", extra: "" });
    setPending(jobId + "__method", { status: "undone", extra: "" });
    delete checkInLockRef.current[jobId];
    delete cascadedTodayRef.current[normalizeId(jobId)];
    delete paymentLinkRef.current[normalizeId(jobId)];
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, {});
  };

  const handleInvoice = (job) => { setInvoiceJob({ ...job, checkInTime: checkedIn[job.id] || null, checkOutTime: checkedOut[job.id] || null }); };
  const handleInvoiceClose = () => { setInvoiceJob(null); };
  const handleInvoiceCreated = (jobId, invoiceUrl) => {
    const nid = normalizeId(jobId);
    setInvoicedJobs((prev) => ({ ...prev, [jobId]: invoiceUrl }));
    setPending(nid + "__invoice", { status: "invoiced", extra: invoiceUrl });
    flushStatusSaves();
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    updateCalendarEvent(job, { checkIn: checkedIn[jobId], checkOut: checkedOut[jobId], completed: !!completed[jobId], invoiceUrl });
  };

  // Called by InvoiceModal's own built-in "✅ Paid" / "⏳ Awaiting Payment"
  // buttons (it already had this UI — Dashboard doesn't need a second,
  // redundant prompt of its own). Only "pending" does anything here: it
  // creates the Unpaid Accounts entry, using the invoice's own total when
  // available and falling back to asking if it wasn't set for some reason.
  const handlePaymentStatusSaved = (status, info) => {
    if (status !== "pending") return;
    const name = (info?.clientName || "Untitled").trim();
    const addAccount = (amount) => {
      const id = "ar_" + Date.now();
      const account = {
        id,
        name,
        amount,
        dateAdded: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        _key: id,
      };
      setUnpaidAccounts(prev => {
        const next = [...prev, account];
        try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
        return next;
      });
      saveARAccountRow(account, false);
      dbg("💳 Added unpaid account from invoice: " + account.name + " — $" + amount);
    };
    if (info?.amount != null && !isNaN(info.amount) && info.amount > 0) {
      addAccount(info.amount);
      return;
    }
    const amountStr = prompt("Amount owed for " + name + " ($):");
    if (amountStr === null) return;
    const amount = parseFloat(amountStr.trim());
    if (isNaN(amount) || amount <= 0) { alert("Enter a valid dollar amount — skipped adding to Unpaid Accounts."); return; }
    addAccount(amount);
  };

  // Opens the amount + how-they-paid (cash/check) prompt — shared by the
  // job-card Paid/Unpaid toggle and the choice shown right after marking a
  // job complete. Prefills the amount from Today's Earnings if one's
  // already set, but always asks for the payment method since that's
  // never been captured yet even if a $ value was.
  const openPaidPrompt = (nid, cleanTitle) => {
    const existingVal = jobValues[nid];
    setPayAmountPrompt({ nid, cleanTitle, kind: "paid" });
    setPayAmountInput(existingVal != null && !isNaN(existingVal) ? String(existingVal) : "");
    setPayMethodInput(null);
  };

  // Actually commits a "paid" job: marks it paid, records how (cash/check),
  // adds the amount into Today's Earnings, and — if this job had an open
  // Unpaid Accounts entry from an earlier "awaiting payment" — closes that
  // entry out so paid/unpaid never leaves duplicate or orphaned AR rows.
  const markPaidStatusWithDetails = (nid, amount, method) => {
    setPaymentStatus(prev => ({ ...prev, [nid]: "paid" }));
    setPending(nid + "__paid", { status: "paid", extra: "" });
    setPaymentMethod(prev => ({ ...prev, [nid]: method }));
    setPending(nid + "__method", { status: method, extra: "" });
    setJobValues(prev => {
      const next = { ...prev, [nid]: amount };
      try { localStorage.setItem("techportal_jobValues_" + selectedDate.toDateString(), JSON.stringify(next)); } catch {}
      return next;
    });
    setPending(nid + "__value", { status: "jobValue", extra: String(amount) });
    flushStatusSaves();
    const linkedKey = paymentLinkRef.current[nid];
    if (linkedKey) {
      const acct = unpaidAccounts.find(a => a._key === linkedKey);
      if (acct) {
        setUnpaidAccounts(prev => {
          const next = prev.filter(a => a._key !== linkedKey);
          try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
          return next;
        });
        saveARAccountRow({ ...acct, paid: true }, true);
        dbg("💳 Marked paid: " + acct.name);
      }
      delete paymentLinkRef.current[nid];
    }
  };

  const markUnpaidStatus = (nid, cleanTitle) => {
    // Prefill from Today's Earnings if a $ value is already set (no need to
    // ask again); otherwise open the amount modal.
    const existingVal = jobValues[nid];
    if (existingVal != null && !isNaN(existingVal) && existingVal > 0) {
      setPaymentStatus(prev => ({ ...prev, [nid]: "unpaid" }));
      setPending(nid + "__paid", { status: "unpaid", extra: "" });
      flushStatusSaves();
      addUnpaidAccountForJob(nid, cleanTitle, existingVal);
      return;
    }
    setPayAmountPrompt({ nid, cleanTitle, kind: "unpaid" });
    setPayAmountInput("");
  };

  // Quick Paid/Unpaid toggle right on the job card — separate from the full
  // invoice flow, for jobs you're tracking payment on without generating a
  // formal invoice. Toggling to "unpaid" creates an Unpaid Accounts entry;
  // toggling to "paid" opens the same amount+method prompt the complete
  // flow uses, so however you get to "paid" it's captured the same way.
  const handleTogglePaid = (jobId, jobTitle) => {
    const nid = normalizeId(jobId);
    const current = paymentStatus[nid];
    const cleanTitle = (jobTitle || "This job").replace(/^(⚠️ MISSED - )+/, "");
    if (current === "unpaid") { openPaidPrompt(nid, cleanTitle); return; }
    markUnpaidStatus(nid, cleanTitle);
  };

  // Shared by handleTogglePaid's prefilled-value path and the amount modal
  // below — creates the Unpaid Accounts entry and flows the amount into
  // Today's Earnings too, same persistence handleSetJobValue uses, so
  // entering it once here covers both places.
  const addUnpaidAccountForJob = (nid, cleanTitle, amount) => {
    const id = "ar_" + Date.now();
    const account = {
      id, name: cleanTitle, amount,
      dateAdded: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      _key: id,
    };
    setUnpaidAccounts(prev => {
      const next = [...prev, account];
      try { localStorage.setItem("techportal_unpaidAccounts", JSON.stringify(next)); } catch {}
      return next;
    });
    saveARAccountRow(account, false);
    paymentLinkRef.current[nid] = id;
    dbg("💳 Added unpaid account from job card: " + account.name + " — $" + amount);
    setJobValues(prev => {
      const next = { ...prev, [nid]: amount };
      try { localStorage.setItem("techportal_jobValues_" + selectedDate.toDateString(), JSON.stringify(next)); } catch {}
      return next;
    });
    setPending(nid + "__value", { status: "jobValue", extra: String(amount) });
    flushStatusSaves();
  };

  const handleConfirmPayAmount = () => {
    const amount = parseFloat(payAmountInput.trim());
    if (isNaN(amount) || amount < 0) { alert("Enter a valid dollar amount."); return; }
    const { nid, cleanTitle, kind } = payAmountPrompt;

    if (kind === "paid") {
      if (!payMethodInput) { alert("Select Cash, Check, or CC."); return; }
      markPaidStatusWithDetails(nid, amount, payMethodInput);
      setPayAmountPrompt(null);
      setPayAmountInput("");
      setPayMethodInput(null);
      return;
    }

    if (amount === 0) {
      // Nothing owed — leave it as paid, no Unpaid Accounts entry needed.
      setPayAmountPrompt(null);
      setPayAmountInput("");
      return;
    }
    setPaymentStatus(prev => ({ ...prev, [nid]: "unpaid" }));
    setPending(nid + "__paid", { status: "unpaid", extra: "" });
    flushStatusSaves();
    addUnpaidAccountForJob(nid, cleanTitle, amount);
    setPayAmountPrompt(null);
    setPayAmountInput("");
  };

  const handleUndoFinishDay = async () => {
    setDayFinished(false); setConfirmFinish(false); setDayStatus("Day started — resumed");
    setPending("__DAY_FINISHED__", { status: "unfinished", extra: "" });
    setPending("__DAY_STARTED__", { status: "started", extra: "resumed" });
    saveMileage(prev => prev.filter(m => m.jobId !== "__home__"));
    await flushStatusSaves();
  };

  const saveMissedJobs = (jobs) => { setMissedJobs(jobs); try { localStorage.setItem("techportal_missedJobs", JSON.stringify(jobs)); } catch {} };

  const handleMissed = (jobId, jobTitle, jobLocation, jobCalendarId, jobEventId) => {
    const token = accessTokenRef.current;
    const cleanTitle = jobTitle.replace(/^(⚠️ MISSED - )+/, "");
    dbg("⚠️ Marking missed: " + cleanTitle);
    const missed = { jobId, jobTitle: cleanTitle, jobLocation, calendarId: jobCalendarId, eventId: jobEventId, date: selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), missedAt: Date.now() };
    const existing = JSON.parse(localStorage.getItem("techportal_missedJobs") || "[]");
    saveMissedJobs([...existing.filter(m => m.jobId !== jobId), missed]);
    setCompleted(prev => ({ ...prev, [jobId]: true }));
    setPending(jobId + "__done", { status: "missed", extra: cleanTitle });
    flushStatusSaves();
    if (jobCalendarId && jobEventId && token) {
      fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(jobCalendarId) + "/events/" + jobEventId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ summary: "⚠️ MISSED - " + cleanTitle }),
      }).then(r => { if (!r.ok) dbg("❌ Calendar title update failed for " + cleanTitle + ": " + r.status, "error"); else dbg("✅ Calendar title updated: " + cleanTitle); })
        .catch(e => dbg("❌ Calendar title update error for " + cleanTitle + ": " + e.message, "error"));
    } else {
      dbg("⚠️ Skipped calendar title update for " + cleanTitle + " — missing calendarId/eventId/token", "warn");
    }
  };

  const handleNotesSaved = async (jobId, notes, photos) => {
    const token = accessTokenRef.current;
    const sheetId = await getOrCreateLogSheet();
    if (!sheetId || !token) return;
    const dateKey = selectedDateRef.current.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const job = jobs.find(j => normalizeId(j.id) === jobId);
    const photoLinks = photos.map(p => p.url).join(", ");
    await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + "/values/'" + STATUS_SHEET_NAME + "'!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ values: [[dateKey, jobId + "__notes", "notes", notes + (photoLinks ? " | Photos: " + photoLinks : "")]] }),
    });
    if (job) { job.notes = notes; job.photos = photos; }
    dbg("📝 Notes saved for " + (job?.title || jobId));
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
    const fromPos = lastPositionRef.current || startPosRef.current;
    if (!fromPos) { alert("GPS not ready."); return; }
    const livePos = locationRef.current;
    if (!livePos) { alert("GPS not available."); return; }
    const label = prompt("What's this leg for?");
    if (!label) return;
    const from = mileageLog.length > 0 ? mileageLog[mileageLog.length - 1].jobTitle : "Last stop";
    const miles = await getDrivingMiles(fromPos.lat, fromPos.lng, livePos.lat, livePos.lng);
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (miles > 0.05 && miles < 150) { saveMileage((prev) => [...prev, { jobId: "manual_" + Date.now(), jobTitle: label, from, miles, time, checkIn: time }]); setLastPos({ lat: livePos.lat, lng: livePos.lng }); }
    else { alert("Miles: " + miles + " — too small or too large."); }
  };

  const handleSetJobValue = (jobId, jobTitle) => {
    const current = jobValues[jobId];
    const input = prompt("Job value for " + jobTitle + " ($):", current != null ? String(current) : "");
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    if (trimmed === "") return;
    const val = parseFloat(trimmed);
    if (isNaN(val) || val < 0) { alert("Enter a valid dollar amount (e.g. 45 or 45.50)."); return; }
    setJobValues(prev => {
      const next = { ...prev, [jobId]: val };
      try { localStorage.setItem("techportal_jobValues_" + selectedDate.toDateString(), JSON.stringify(next)); } catch {}
      return next;
    });
    setPending(jobId + "__value", { status: "jobValue", extra: String(val) });
    flushStatusSaves();
    dbg("💰 Set job value for " + jobTitle + ": $" + val);
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
  const handleExportDebug = () => {
    const lines = [...debugLog].reverse(); // debugLog is newest-first; report reads oldest-first
    const header = [
      "TechPortal Debug Report",
      "App version: " + APP_VERSION,
      "Exported: " + new Date().toLocaleString(),
      "Entries: " + lines.length,
      "".padEnd(50, "="),
      "",
    ].join("\n");
    const body = lines.map(e => e.time + "  [" + (e.type || "info").toUpperCase() + "]  " + e.msg).join("\n");
    const text = header + body + "\n";
    const filename = "techportal-debug-" + new Date().toISOString().slice(0, 10) + "-" + Date.now() + ".txt";

    const download = () => {
      try {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { alert("Export failed: " + e.message); }
    };

    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([text], filename, { type: "text/plain" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "TechPortal Debug Report" }).catch(() => {});
          return;
        }
      } catch {}
    }
    download();
  };

  const dotStyle = { width: 8, height: 8, borderRadius: "50%", background: location ? "#27500A" : "#888", display: "inline-block", marginRight: 4 };
  const modalEvents = modalType === "completed" ? completedEvents : remainingEvents;
  const modalTitleText = modalType === "completed" ? "Completed This Month" : "Remaining This Month";

  return (
    React.createElement("div", { style: styles.page },
      invoiceJob && React.createElement(InvoiceModal, { job: invoiceJob, accessToken, onClose: handleInvoiceClose, onInvoiceCreated: handleInvoiceCreated, onPaymentStatusSaved: handlePaymentStatusSaved }),
      showEtsy && React.createElement(EtsyStats, { onClose: () => setShowEtsy(false) }),
      showMonthView && React.createElement(CalendarMonthView, {
        accessToken,
        initialDate: selectedDate,
        onSelectDay: (d) => { setSelectedDate(d); setFilter("All"); setShowMonthView(false); },
        onClose: () => setShowMonthView(false),
      }),
      showUnpaidPage && React.createElement("div", { style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#fff", zIndex: 500, overflowY: "auto" } },
        React.createElement("div", { style: styles.topbar },
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            React.createElement("button", { style: styles.hamburgerBtn, onClick: () => setShowUnpaidPage(false) }, "←"),
            React.createElement("div", { style: styles.name }, "💳 Unpaid Accounts")
          ),
          React.createElement("div", { style: { display: "flex", gap: 6 } },
            React.createElement("button", { style: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 }, onClick: handleAddUnpaidAccountFromJob }, "📅 From job"),
            React.createElement("button", { style: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#F0F4FF", color: "#185FA5", border: "none", cursor: "pointer", fontWeight: 500 }, onClick: handleAddUnpaidAccount }, "+ Add account")
          )
        ),
        React.createElement("div", { style: { ...styles.mileageBar, margin: "1rem 1.5rem" } },
          unpaidAccounts.length === 0
            ? React.createElement("div", { style: styles.mileageEmpty }, "No unpaid accounts")
            : unpaidAccounts.map((a, i) => {
                const key = a._key || a.id || ("idx_" + i);
                return React.createElement("div", { key, style: styles.mileageRow },
                  React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, flex: 1, cursor: "pointer" }, onClick: () => handleEditUnpaidAccount(key) },
                    React.createElement("span", null, a.name),
                    React.createElement("span", { style: { fontSize: 11, color: "#888" } }, "Added " + a.dateAdded)
                  ),
                  React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                    React.createElement("span", { style: styles.mileageVal }, "$" + a.amount.toFixed(2)),
                    React.createElement("button", { onClick: (e) => { e.stopPropagation(); handleOpenInvoicePrompt(key); }, style: { fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 500 }, title: "Email an invoice" }, "✉️ Invoice"),
                    React.createElement("button", { onClick: (e) => { e.stopPropagation(); handleMarkPaid(key); }, style: { fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#27500A", color: "#fff", border: "none", cursor: "pointer", fontWeight: 500 }, title: "Mark as paid" }, "✓ Paid"),
                    React.createElement("button", { onClick: (e) => { e.stopPropagation(); handleDeleteUnpaidAccount(key); }, style: { fontSize: 14, color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", fontWeight: 700, lineHeight: 1 }, title: "Delete this entry (not the same as paid)" }, "✕")
                  )
                );
              }),
          unpaidAccounts.length > 0 && React.createElement("div", { style: styles.mileageTotal },
            React.createElement("span", null, "Total outstanding"),
            React.createElement("span", null, "$" + unpaidAccounts.reduce((s, a) => s + a.amount, 0).toFixed(2))
          )
        )
      ),
      rescheduleJob && React.createElement(RescheduleModal, {
        missed: rescheduleJob,
        accessToken: accessTokenRef.current,
        onReschedule: handleReschedule,
        onDismiss: (m) => { saveMissedJobs(missedJobs.filter(x => x.jobId !== m.jobId)); setRescheduleJob(null); },
        onClose: () => { setRescheduleJob(null); setShowMissedModal(true); },
      }),
      driveMode && React.createElement(DriveMode, {
        jobs, checkedIn, checkedOut, completed, location,
        onCheckIn: (nid, title) => handleCheckIn(nid, title),
        onCheckOut: (nid, title) => handleCheckOut(nid, title),
        onComplete: (nid) => handleComplete(nid),
        dayStarted, displayMiles,
        onExit: () => setDriveMode(false),
      }),
      React.createElement("div", { style: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999 } },
        React.createElement("button", { onClick: () => setShowDebug(p => !p), style: { width: "100%", padding: "6px", background: "#1a1a2e", color: "#7dd3fc", fontSize: 11, fontFamily: "monospace", border: "none", cursor: "pointer", textAlign: "left" } }, "🔧 Debug (" + debugLog.length + " errors) — tap to " + (showDebug ? "hide" : "show")),
        showDebug && React.createElement("div", { style: { background: "#0d0d1a", color: "#cdd6f4", fontFamily: "monospace", fontSize: 10, padding: "8px", maxHeight: 200, overflowY: "auto", borderTop: "1px solid #333" } },
          React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 4 } },
            React.createElement("button", { onClick: () => { setDebugLog([]); try { localStorage.removeItem("techportal_debugLog_" + new Date().toDateString()); } catch {} }, style: { fontSize: 10, padding: "2px 8px", background: "#333", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" } }, "Clear"),
            React.createElement("button", { onClick: handleExportDebug, style: { fontSize: 10, padding: "2px 8px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" } }, "⬆ Export")
          ),
          debugLog.map((e, i) => React.createElement("div", { key: i, style: { color: e.type === "error" ? "#f38ba8" : e.type === "warn" ? "#f9e2af" : "#a6e3a1", marginBottom: 2 } }, e.time + " " + e.msg))
        )
      ),
      menuOpen && React.createElement("div", { style: styles.menuOverlay, onClick: () => setMenuOpen(false) },
        React.createElement("div", { style: styles.menuDrawer, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.menuHeader }, React.createElement("div", { style: styles.menuTitle }, "Menu"), React.createElement("button", { style: styles.menuClose, onClick: () => setMenuOpen(false) }, "×")),
          React.createElement("div", { style: styles.menuSection },
            React.createElement("div", { style: styles.menuSectionLabel }, "📊 Logs & Reports"),
            React.createElement("a", { href: "#", style: styles.menuItem, onClick: async e => { e.preventDefault(); const id = logSheetId || await getOrCreateLogSheet(); if (id) window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0", "_blank"); setMenuOpen(false); } }, "📋 Job Log"),
            React.createElement("button", { style: { ...styles.menuItem, background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "system-ui, sans-serif" }, onClick: () => { setMenuOpen(false); setShowUnpaidPage(true); } }, "💳 Unpaid Accounts")
          ),
          React.createElement("div", { style: styles.menuSection }, React.createElement("div", { style: styles.menuSectionLabel }, "⛳ Golf"), React.createElement("a", { href: "/golf", style: styles.menuItem, onClick: () => setMenuOpen(false) }, "⛳ Golf Scorecard")),
          React.createElement("div", { style: styles.menuSection }, React.createElement("div", { style: styles.menuSectionLabel }, "🛍️ Etsy"), React.createElement("button", { style: { ...styles.menuItem, background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "system-ui, sans-serif" }, onClick: () => { setMenuOpen(false); setShowEtsy(true); } }, "🛍️ Etsy Shop Stats")),
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
      arPicker && React.createElement("div", { style: styles.overlay, onClick: () => { setArPicker(null); setArAmountInput(""); } },
        React.createElement("div", { style: styles.modalBox, onClick: e => e.stopPropagation() },
          arPicker.step === "pick"
            ? React.createElement(React.Fragment, null,
                React.createElement("div", { style: styles.modalHeader },
                  React.createElement("div", { style: styles.modalTitle }, "💳 Pick a job (" + arCandidates.length + ")"),
                  React.createElement("button", { style: styles.modalClose, onClick: () => setArPicker(null) }, "×")
                ),
                React.createElement("div", { style: styles.modalList },
                  arCandidates.length === 0
                    ? React.createElement("div", { style: styles.modalEmpty }, "No completed jobs found this month.")
                    : arCandidates.map(e => {
                        const start = new Date(e.start?.dateTime || e.start?.date);
                        const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                        const title = (e.summary || "Untitled").replace(/^(⚠️ MISSED - )+/, "");
                        return React.createElement("div", { key: e.id, style: { ...styles.modalRow, cursor: "pointer" }, onClick: () => handlePickArJob(e) },
                          React.createElement("div", { style: styles.modalRowDate }, dateStr),
                          React.createElement("div", { style: styles.modalRowTitle }, title)
                        );
                      })
                )
              )
            : React.createElement(React.Fragment, null,
                React.createElement("div", { style: styles.modalHeader },
                  React.createElement("div", { style: styles.modalTitle }, arPicker.title),
                  React.createElement("button", { style: styles.modalClose, onClick: () => { setArPicker(null); setArAmountInput(""); } }, "×")
                ),
                React.createElement("div", { style: { padding: "1.25rem" } },
                  React.createElement("label", { style: { fontSize: 13, color: "#666", display: "block", marginBottom: 6 } }, "Amount owed ($)"),
                  React.createElement("input", {
                    type: "number", inputMode: "decimal", autoFocus: true, value: arAmountInput,
                    onChange: e => setArAmountInput(e.target.value),
                    onKeyDown: e => { if (e.key === "Enter") handleConfirmArAmount(); },
                    style: { width: "100%", padding: "10px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box", marginBottom: 14 },
                  }),
                  React.createElement("div", { style: { display: "flex", gap: 8 } },
                    React.createElement("button", { onClick: () => setArPicker({ step: "pick" }), style: { flex: 1, padding: "10px", borderRadius: 8, background: "#f5f5f3", color: "#666", border: "none", cursor: "pointer", fontWeight: 500 } }, "← Back"),
                    React.createElement("button", { onClick: handleConfirmArAmount, style: { flex: 1, padding: "10px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 } }, "Add account")
                  )
                )
              )
        )
      ),
      payAmountPrompt && React.createElement("div", { style: styles.overlay, onClick: () => { setPayAmountPrompt(null); setPayAmountInput(""); setPayMethodInput(null); } },
        React.createElement("div", { style: styles.modalBox, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.modalHeader },
            React.createElement("div", { style: styles.modalTitle }, (payAmountPrompt.kind === "paid" ? "Payment for " : "Amount owed for ") + payAmountPrompt.cleanTitle),
            React.createElement("button", { style: styles.modalClose, onClick: () => { setPayAmountPrompt(null); setPayAmountInput(""); setPayMethodInput(null); } }, "×")
          ),
          React.createElement("div", { style: { padding: "1.25rem" } },
            React.createElement("label", { style: { fontSize: 13, color: "#666", display: "block", marginBottom: 6 } }, payAmountPrompt.kind === "paid" ? "Amount received ($)" : "Amount owed ($) — enter 0 if already paid"),
            React.createElement("input", {
              type: "number", inputMode: "decimal", autoFocus: true, value: payAmountInput,
              onChange: e => setPayAmountInput(e.target.value),
              onKeyDown: e => { if (e.key === "Enter" && (payAmountPrompt.kind !== "paid" || payMethodInput)) handleConfirmPayAmount(); },
              style: { width: "100%", padding: "10px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box", marginBottom: 14 },
            }),
            payAmountPrompt.kind === "paid" && React.createElement("div", { style: { marginBottom: 14 } },
              React.createElement("label", { style: { fontSize: 13, color: "#666", display: "block", marginBottom: 6 } }, "How'd they pay?"),
              React.createElement("div", { style: { display: "flex", gap: 8 } },
                React.createElement("button", {
                  onClick: () => setPayMethodInput("cash"),
                  style: { flex: 1, padding: "10px", borderRadius: 8, border: payMethodInput === "cash" ? "2px solid #27500A" : "1px solid #ccc", background: payMethodInput === "cash" ? "#EAF3DE" : "#fff", color: payMethodInput === "cash" ? "#27500A" : "#444", cursor: "pointer", fontWeight: 600, fontSize: 14 },
                }, "💵 Cash"),
                React.createElement("button", {
                  onClick: () => setPayMethodInput("check"),
                  style: { flex: 1, padding: "10px", borderRadius: 8, border: payMethodInput === "check" ? "2px solid #0C447C" : "1px solid #ccc", background: payMethodInput === "check" ? "#E6F1FB" : "#fff", color: payMethodInput === "check" ? "#0C447C" : "#444", cursor: "pointer", fontWeight: 600, fontSize: 14 },
                }, "📝 Check"),
                React.createElement("button", {
                  onClick: () => setPayMethodInput("cc"),
                  style: { flex: 1, padding: "10px", borderRadius: 8, border: payMethodInput === "cc" ? "2px solid #5B2C8D" : "1px solid #ccc", background: payMethodInput === "cc" ? "#F1E9F8" : "#fff", color: payMethodInput === "cc" ? "#5B2C8D" : "#444", cursor: "pointer", fontWeight: 600, fontSize: 14 },
                }, "💳 CC")
              )
            ),
            React.createElement("button", { onClick: handleConfirmPayAmount, style: { width: "100%", padding: "10px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 } }, "Save")
          )
        )
      ),
      invoiceEmailPrompt && React.createElement("div", { style: styles.overlay, onClick: () => { setInvoiceEmailPrompt(null); setInvoiceEmailInput(""); } },
        React.createElement("div", { style: styles.modalBox, onClick: e => e.stopPropagation() },
          React.createElement("div", { style: styles.modalHeader },
            React.createElement("div", { style: styles.modalTitle }, "Send Invoice"),
            React.createElement("button", { style: styles.modalClose, onClick: () => { setInvoiceEmailPrompt(null); setInvoiceEmailInput(""); } }, "×")
          ),
          React.createElement("div", { style: { padding: "1.25rem" } },
            React.createElement("label", { style: { fontSize: 13, color: "#666", display: "block", marginBottom: 6 } }, "Customer's email"),
            React.createElement("input", {
              type: "email", inputMode: "email", autoFocus: true, placeholder: "customer@example.com", value: invoiceEmailInput,
              onChange: e => setInvoiceEmailInput(e.target.value),
              onKeyDown: e => { if (e.key === "Enter") handleSendInvoice(); },
              style: { width: "100%", padding: "10px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", boxSizing: "border-box", marginBottom: 10 },
            }),
            React.createElement("div", { style: { fontSize: 12, color: "#888", marginBottom: 14, lineHeight: 1.4 } }, "Opens your email app with the invoice, the Square pay-online link, and check-by-mail instructions already filled in — review and hit send."),
            React.createElement("button", { onClick: handleSendInvoice, style: { width: "100%", padding: "10px", borderRadius: 8, background: "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 } }, "✉️ Open Email to Send")
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
          isToday && dayStarted && !dayFinished && React.createElement("button", { style: { fontSize: 12, padding: "6px 12px", borderRadius: 8, background: "#1a1a2e", color: "#7dd3fc", border: "1px solid #333", cursor: "pointer", fontWeight: 600 }, onClick: () => setDriveMode(true) }, "🚗 Drive"),
          React.createElement("button", { style: styles.refreshBtn, onClick: refresh }, "↻"),
          React.createElement("button", { style: styles.logoutBtn, onClick: onLogout }, "Sign out")
        )
      ),
      missedJobs.length > 0 && React.createElement("div", { style: { background: "linear-gradient(90deg, #FFF6DA 0%, #FCE28A 100%)", borderBottom: "0.5px solid #f0c040", padding: "10px 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }, onClick: () => setShowMissedModal(true) },
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
        React.createElement("div", { style: { cursor: "pointer" }, onClick: () => setShowMonthView(true), title: "Open month calendar" }, React.createElement("div", { style: styles.monthText }, "📅 " + monthName + "  ›"), React.createElement("div", { style: styles.monthSub }, monthlyCount !== null ? monthlyCount + " total jobs" : "Loading...")),
        React.createElement("div", { style: styles.monthRight },
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("completed") }, React.createElement("div", { style: styles.monthStatVal }, totalCompleted), React.createElement("div", { style: styles.monthStatLabel }, "completed")),
          React.createElement("div", { style: styles.monthDivider }),
          React.createElement("button", { style: styles.monthStatBtn, onClick: () => setModalType("remaining") }, React.createElement("div", { style: { ...styles.monthStatVal, color: "#FAEEDA" } }, remaining !== null ? remaining : "-"), React.createElement("div", { style: styles.monthStatLabel }, "remaining")),
          React.createElement("div", { style: styles.monthDivider }),
          React.createElement("div", { style: styles.monthStatBtn }, React.createElement("div", { style: { ...styles.monthStatVal, color: "#7dd3fc" } }, monthlyMiles !== null ? monthlyMiles + " mi" : "—"), React.createElement("div", { style: styles.monthStatLabel }, "this month"))
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
        dayFinished
          ? React.createElement("div", { style: styles.dayStatus }, displayMiles + " mi · " + (dayHours !== null ? dayHours.toFixed(1) + " hrs" : "—") + " today")
          : (dayStatus && React.createElement("div", { style: styles.dayStatus }, dayStatus)),
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
                  m.checkIn && React.createElement("span", { style: { fontSize: 11, color: "#888" } }, "⏱ " + m.checkIn + (m.checkOut ? " – " + m.checkOut : "") + (duration ? " (" + duration + ")" : ""))
                ),
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                  React.createElement("span", { style: styles.mileageVal }, m.miles > 0 ? m.miles + " mi" : "—"),
                  m.jobId !== "__home__" && m.jobId !== "__finish__" && React.createElement("button", { onClick: () => saveMileage(prev => prev.filter((_, idx) => idx !== i)), style: { fontSize: 14, color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", fontWeight: 700, lineHeight: 1 }, title: "Remove this leg" }, "✕")
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
      (isToday || Object.keys(jobValues).length > 0) && React.createElement("div", { style: styles.mileageBar },
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
          React.createElement("div", { style: styles.mileageTitle }, "💰 Today's Earnings")
        ),
        jobs.length === 0
          ? React.createElement("div", { style: styles.mileageEmpty }, "No jobs today to add values to")
          : jobs.map((job) => {
              const nid = normalizeId(job.id);
              const val = jobValues[nid];
              const pStatus = paymentStatus[nid];
              const method = paymentMethod[nid];
              // Paid jobs turn green, awaiting-payment jobs turn red, so
              // payment status reads at a glance without opening each job.
              const rowTint = pStatus === "paid" ? { background: "#EAF3DE" } : pStatus === "unpaid" ? { background: "#FBE1DE" } : {};
              const textColor = pStatus === "paid" ? "#27500A" : pStatus === "unpaid" ? "#B23A24" : "#1a1a1a";
              const methodLabel = method === "cash" ? "Cash" : method === "check" ? "Check" : method === "cc" ? "CC" : "";
              const valueLabel = val != null
                ? "$" + val.toFixed(2) + (pStatus === "paid" && methodLabel ? " · " + methodLabel : "")
                : "+ add $";
              return React.createElement("div", {
                key: job.id,
                style: { ...styles.mileageRow, cursor: "pointer", borderRadius: 6, padding: "4px 6px", margin: "1px 0", ...rowTint },
                onClick: () => handleSetJobValue(nid, job.title),
              },
                React.createElement("span", { style: { color: textColor } }, job.title),
                React.createElement("span", { style: val != null ? { ...styles.mileageVal, color: textColor } : { color: "#bbb", fontStyle: "italic" } }, valueLabel)
              );
            }),
        React.createElement("div", { style: styles.mileageTotal },
          React.createElement("span", null, "Total revenue"),
          React.createElement("span", null, "$" + totalRevenue.toFixed(2))
        ),
        dayHours !== null && React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginTop: 4 } },
          React.createElement("span", null, "Hours worked"),
          React.createElement("span", null, dayHours.toFixed(1) + " hr")
        ),
        hourlyRate !== null && React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: "#27500A", marginTop: 6, paddingTop: 6, borderTop: "0.5px solid #e0e0e0" } },
          React.createElement("span", null, "Effective rate"),
          React.createElement("span", null, "$" + hourlyRate.toFixed(2) + " / hr")
        ),
        dayHours === null && Object.keys(jobValues).length > 0 && React.createElement("div", { style: { fontSize: 11, color: "#bbb", fontStyle: "italic", marginTop: 6 } }, "Start your day to begin tracking hours")
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
              paymentStatus: paymentStatus[nid],
              paymentMethod: paymentMethod[nid],
              accessToken: accessTokenRef.current,
              logSheetId,
              onTimeUpdated: refresh,
              onNotesSaved: handleNotesSaved,
              onCheckIn: () => handleCheckIn(nid, job.title),
              onCheckOut: () => handleCheckOut(nid, job.title),
              onComplete: (paymentChoice) => handleComplete(nid, paymentChoice),
              onNavigate: () => handleNavigate(nid),
              onUndo: () => handleUndo(nid),
              onInvoice: () => handleInvoice({ ...job, id: nid }),
              onMissed: () => handleMissed(nid, job.title, job.location, job.calendarId, job.id),
              onTogglePaid: () => handleTogglePaid(nid, job.title),
              website: clientWebsites[clientKeyFor(job.title)]?.website || "",
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
  monthBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.5rem", background: "linear-gradient(135deg, #2278CC 0%, #123F6E 100%)" },
  monthText: { fontSize: 14, fontWeight: 600, color: "#fff" }, monthSub: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  monthRight: { display: "flex", alignItems: "center", gap: 16 },
  monthStatBtn: { textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8 },
  monthStatVal: { fontSize: 20, fontWeight: 700, color: "#fff" },
  monthStatLabel: { fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.04em" },
  monthDivider: { width: 1, height: 32, background: "rgba(255,255,255,0.3)" },
  dayBar: { display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1.5rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0", flexWrap: "wrap" },
  startBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, background: "linear-gradient(135deg, #3E7A11 0%, #1D3A05 100%)", boxShadow: "0 2px 6px rgba(39,80,10,0.35)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 },
  finishBtn: { fontSize: 13, padding: "8px 18px", borderRadius: 8, background: "linear-gradient(135deg, #8A5410 0%, #4A2604 100%)", boxShadow: "0 2px 6px rgba(99,56,6,0.35)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 },
  dayStatus: { fontSize: 12, color: "#666" },
  sheetLink: { fontSize: 12, color: "#185FA5", marginLeft: "auto" },
  mileageBar: { margin: "1rem 1.5rem 0", background: "#fff", border: "0.5px solid #e0e0e0", borderRadius: 12, padding: "0.75rem 1rem" },
  mileageTitle: { fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 },
  mileageEmpty: { fontSize: 13, color: "#bbb", fontStyle: "italic", paddingBottom: 6 },
  mileageRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#444", padding: "4px 0", borderBottom: "0.5px solid #f5f5f3" },
  mileageVal: { color: "#1a1a1a", fontWeight: 500 },
  mileageTotal: { display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: "#1a1a1a", borderTop: "0.5px solid #e0e0e0", marginTop: 6, paddingTop: 6 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, padding: "1.25rem 1.5rem 0" },
  statCard: { background: "linear-gradient(135deg, #fafaf9 0%, #eeeeec 100%)", border: "0.5px solid #e6e6e3", borderRadius: 8, padding: "0.75rem 1rem" }, statLabel: { fontSize: 12, color: "#888", marginBottom: 4 }, statVal: { fontSize: 24, fontWeight: 600, color: "#1a1a1a" },
  filterRow: { display: "flex", gap: 8, padding: "1rem 1.5rem 0", flexWrap: "wrap" },
  filterBtn: { fontSize: 12, padding: "5px 14px", borderRadius: 20, border: "0.5px solid #ccc", background: "#fff", color: "#666", cursor: "pointer" },
  filterActive: { background: "linear-gradient(135deg, #2278CC 0%, #123F6E 100%)", color: "#fff", borderColor: "#185FA5" },
  dateNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem 0" },
  navBtn: { fontSize: 13, padding: "6px 14px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", color: "#1a1a1a", cursor: "pointer" },
  dateCenter: { textAlign: "center" }, dateLabel: { fontSize: 13, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.05em" },
  todayBtn: { fontSize: 12, color: "#185FA5", background: "none", border: "none", cursor: "pointer", marginTop: 2 },
  jobList: { padding: "0.75rem 1.5rem", display: "flex", flexDirection: "column", gap: 10 },
  message: { fontSize: 14, color: "#888", padding: "2rem 0", textAlign: "center" },
  // zIndex 4000 — these prompts (pay amount, invoice email, missed, etc.)
  // can be opened from a button inside JobDetailModal (zIndex 3000) or
  // InvoiceModal (zIndex 3500) without either one closing first, so this
  // overlay has to render above both or it ends up stuck peeking out from
  // behind whichever detail modal is still open (that's what was happening
  // at zIndex 1000 — tapping "Awaiting Payment" inside the job detail view
  // opened this prompt underneath it instead of on top).
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000, padding: "1rem" },
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
