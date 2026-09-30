import React, { useState, useRef } from "react";
import { findCourseBackground } from "../clientAssets";

// Bump on every user-visible change to this file, independent of
// Dashboard.jsx's own APP_VERSION — this page is a standalone feature
// (see CLAUDE.md) with its own change history. Shown as a small badge next
// to the page title.
const GOLF_VERSION = "2.0.1";

// Course database — edit pars here to match actual scorecards
const COURSES = {
  custom: {
    name: "Custom Course",
    holes: 18,
    pars: [4,4,3,4,5,4,3,5,4,4,4,3,4,5,4,3,5,4],
  },
  riverwood: {
    name: "Riverwood National",
    location: "Otsego, MN",
    holes: 18,
    pars: [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5], // Par 72 — edit to match scorecard
  },
  vintage: {
    name: "Vintage Golf Course",
    location: "Otsego, MN",
    holes: 18,
    pars: [3,3,4,3,3,3,4,3,3,3,3,4,3,3,3,4,3,3], // Par 58 executive — edit to match scorecard
  },
  ponds_red: {
    name: "The Ponds (Red 9)",
    location: "St. Francis, MN",
    holes: 9,
    pars: [4,4,3,4,5,4,3,5,4],  // Par 36 — edit to match scorecard
  },
  ponds_white: {
    name: "The Ponds (White 9)",
    location: "St. Francis, MN",
    holes: 9,
    pars: [4,3,4,5,3,4,4,5,4], // Par 36 — edit to match scorecard
  },
  refuge: {
    name: "The Refuge",
    location: "Oak Grove, MN",
    holes: 18,
    pars: [4,3,4,5,4,3,4,5,4,4,3,5,4,4,3,5,4,4], // Par 72 — edit to match scorecard
  },
  // Albion Ridges is a 27-hole course played as any two of these three
  // nines — added as three separate 9-hole entries (rather than guessing
  // which pair to combine into one 18) so any combination can be played.
  // Pars transcribed directly from the course's own printed scorecard
  // (albionridgesgc.com/scorecard) rather than pulled from the course
  // search API, which doesn't have reliable data for this course.
  albion_boulder: {
    name: "Albion Ridges - Boulder Nine",
    location: "Annandale, MN",
    holes: 9,
    pars: [4,5,4,3,4,4,5,3,4], // Par 36
  },
  albion_rock: {
    name: "Albion Ridges - Rock Nine",
    location: "Annandale, MN",
    holes: 9,
    pars: [4,5,4,3,4,4,3,5,4], // Par 36
  },
  albion_granite: {
    name: "Albion Ridges - Granite Nine",
    location: "Annandale, MN",
    holes: 9,
    pars: [4,4,3,5,4,3,4,5,4], // Par 36
  },
};

// Same three nines as the COURSES.albion_* entries above, keyed for the
// front/back picker below — playing 18 holes at Albion Ridges means
// picking any two of these three, so rather than pre-building all six
// possible 18-hole combos as static entries, the picker builds the pars
// array on the fly (front nine's 9 pars + back nine's 9 pars) and saves it
// as a one-off custom course.
const ALBION_NINES = {
  boulder: { label: "Boulder", pars: [4,5,4,3,4,4,5,3,4] },
  rock: { label: "Rock", pars: [4,5,4,3,4,4,3,5,4] },
  granite: { label: "Granite", pars: [4,4,3,5,4,3,4,5,4] },
};

// The current in-progress card and the custom-course list used to just be
// plain useState with no persistence — closing the PWA (or the phone just
// backgrounding it long enough to get reclaimed) silently threw away
// whatever was on the card. These now round-trip through localStorage so a
// round in progress survives a reload, and finished rounds can be kept
// around in their own history to view or re-send later.
const CURRENT_KEY = "techportal_golfCurrent";
const ROUNDS_KEY = "techportal_golfRounds";
const CUSTOM_COURSES_KEY = "techportal_golfCustomCourses";
const BG_CACHE_KEY = "techportal_golfBgCache";
const BG_OVERRIDE_KEY = "techportal_golfBgOverride";
const ROOM_KEY = "techportal_golfRoom";

// Live sync between two phones needs *some* shared storage, and this app
// has no backend of its own for the golf page (it's pure client-side —
// see CLAUDE.md). Talks directly to a Firebase Realtime Database via its
// plain REST API (no Firebase SDK, no npm dependency — just fetch()),
// scoped to the /golfRooms path, whose security rules are set to open
// read/write for anyone who has the room id (same trust model as "anyone
// with the link" on a Google Doc — fine for a casual round between
// friends, not something to rely on for anything sensitive). Room ids are
// generated client-side (genRoomId below) rather than assigned by the
// server, so there's no response-parsing step that can silently break —
// the first attempt at this (jsonblob.com) failed exactly that way.
const FIREBASE_DB_URL = import.meta.env.VITE_FIREBASE_DB_URL;

function genRoomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function roomUrl(roomId) {
  return FIREBASE_DB_URL.replace(/\/$/, "") + "/golfRooms/" + roomId + ".json";
}

async function createSyncRoom(payload) {
  if (!FIREBASE_DB_URL) throw new Error("Live sync isn't configured yet (missing VITE_FIREBASE_DB_URL).");
  const id = genRoomId();
  await pushSyncRoom(id, payload);
  return id;
}

async function fetchSyncRoom(roomId) {
  const res = await fetch(roomUrl(roomId));
  if (!res.ok) throw new Error("Room not found (" + res.status + ")");
  const data = await res.json();
  if (data == null) throw new Error("Room not found");
  return data;
}

async function pushSyncRoom(roomId, payload) {
  if (!FIREBASE_DB_URL) throw new Error("Live sync isn't configured yet (missing VITE_FIREBASE_DB_URL).");
  const res = await fetch(roomUrl(roomId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Could not update room (" + res.status + ")");
}

function loadJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

// Runs one Wikimedia Commons image search and returns every usable image
// found (up to `limit`), as { thumb, full } — thumb sized for a picker
// grid, full for actually using as the background.
async function searchCommonsImages(query, limit) {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: String(limit), prop: "imageinfo", iiprop: "url|mime",
    iiurlwidth: "500", format: "json", origin: "*",
  });
  const res = await fetch("https://commons.wikimedia.org/w/api.php?" + params.toString());
  const data = await res.json();
  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  return pages
    .map(p => p.imageinfo?.[0])
    .filter(info => info?.mime?.startsWith("image/") && info.mime !== "image/svg+xml")
    .map(info => ({ thumb: info.thumburl || info.url, full: info.url }));
}

// Same two-attempt query strategy as fetchCourseBackground below, but
// returns every candidate instead of picking one automatically — feeds the
// "🔍 Find photo" picker in the course selector, for when the auto-pick
// (or no result at all) isn't what you want.
async function searchBgCandidates(courseName) {
  try {
    let results = await searchCommonsImages(courseName + " golf course", 9);
    if (results.length === 0) results = await searchCommonsImages(courseName, 9);
    return results;
  } catch {
    return [];
  }
}

// Reads a photo picked from the device's own storage/camera roll, scales
// it down to maxWidth (a full-res phone photo is way more than a
// background needs and would blow past localStorage's per-origin size
// cap fast), and returns a compressed JPEG data URL — small enough that
// several courses' worth can live in bgOverrides at once.
function resizeImageFile(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Runs one Wikimedia Commons image search and returns the first usable
// image URL, or null if nothing came back.
async function searchCommonsImage(query) {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "5", prop: "imageinfo", iiprop: "url|mime",
    iiurlwidth: "1600", format: "json", origin: "*",
  });
  const res = await fetch("https://commons.wikimedia.org/w/api.php?" + params.toString());
  const data = await res.json();
  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  const pick = pages
    .map(p => p.imageinfo?.[0])
    .find(info => info?.mime?.startsWith("image/") && info.mime !== "image/svg+xml");
  return pick?.thumburl || pick?.url || null;
}

// Looks up a photo for the course name via Wikimedia Commons' public search
// API — free, no key/signup required, and CORS-enabled for direct
// browser-side use (the origin=* param is what gets it to send the right
// CORS header). Not curated for golf specifically, and small/local courses
// often just aren't on Commons at all, so this tries a "<name> golf
// course" search first and falls back to the bare course name before
// giving up. Only a successful hit is cached (BG_CACHE_KEY) — a miss is
// NOT cached, so a course that comes up empty gets retried next time
// instead of being stuck blank forever.
async function fetchCourseBackground(courseName) {
  try {
    const cache = loadJSON(BG_CACHE_KEY, {});
    if (cache[courseName]) return cache[courseName];
    const url = (await searchCommonsImage(courseName + " golf course")) || (await searchCommonsImage(courseName));
    if (url) { try { localStorage.setItem(BG_CACHE_KEY, JSON.stringify({ ...cache, [courseName]: url })); } catch {} }
    return url;
  } catch {
    return null;
  }
}

function sumScores(arr, holes) {
  return (arr || []).slice(0, holes).reduce((a, v) => a + (v === "" || v == null ? 0 : parseInt(v)), 0);
}

const fmt = v => (v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(2);

// Plain-text rendering of a round (live or saved) for the Text button — one
// shared builder so a round texted straight off the live card and one
// texted later from Saved Rounds look identical. Kept to a compact
// hole-by-hole line rather than a full aligned table since SMS/iMessage
// don't render monospace, so a table wouldn't line up anyway.
function buildScorecardText(r) {
  const lines = [];
  lines.push("⛳ " + r.courseName + " — " + r.date + (r.betPerHole ? " ($" + r.betPerHole + "/hole)" : ""));
  lines.push(r.p1name + ": " + sumScores(r.scores.p1, r.holes) + "   " + r.p2name + ": " + sumScores(r.scores.p2, r.holes));
  lines.push("");
  for (let i = 0; i < r.holes; i++) {
    const s1 = r.scores.p1[i] || "-";
    const s2 = r.scores.p2[i] || "-";
    const res = r.results[i];
    let tag = "";
    if (res?.winner === 1) tag = " → " + r.p1name + " +$" + res.amount;
    else if (res?.winner === 2) tag = " → " + r.p2name + " +$" + res.amount;
    else if (res?.winner === 0 && res.carryover > 0) tag = " → push";
    if (res?.greenieWinner === 1) tag += " · 🟢 " + r.p1name + " +$" + res.greenieAmt;
    else if (res?.greenieWinner === 2) tag += " · 🟢 " + r.p2name + " +$" + res.greenieAmt;
    lines.push("Hole " + (i + 1) + " (par " + r.pars[i] + "): " + s1 + " / " + s2 + tag);
  }
  lines.push("");
  lines.push(r.p1name + " " + fmt(r.p1money) + "  ·  " + r.p2name + " " + fmt(r.p2money));
  return lines.join("\n");
}

// Prefers the native share sheet (lets the tech pick Messages, WhatsApp,
// email, whatever) and falls back to opening the Messages app directly via
// an sms: link — iOS and Android expect a different separator before
// `body=`, hence the UA check.
function shareScorecard(r) {
  const text = buildScorecardText(r);
  if (navigator.share) {
    navigator.share({ title: "⛳ " + r.courseName + " Scorecard", text }).catch(() => {});
    return;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  window.location.href = "sms:" + (isIOS ? "&" : "?") + "body=" + encodeURIComponent(text);
}

// Pulls a name/city/state out of a search-result row from api/golfcourses
// (?action=search). Written defensively — OpenGolfAPI's exact field names
// couldn't be confirmed against a live response from this environment, so
// this tries a few plausible variants rather than assuming one.
function parseSearchResult(row) {
  return {
    id: row.id ?? row.courseId ?? row.course_id ?? row.slug,
    name: row.name ?? row.courseName ?? row.course_name ?? "Unknown course",
    city: row.city ?? row.locality ?? "",
    state: row.state ?? row.stateCode ?? row.state_code ?? "",
  };
}

// Same defensiveness for the ?action=detail payload (which is
// { course, holes } as assembled by api/golfcourses.js). Tries several
// shapes for where the hole array and each hole's par/number might live.
// Always returns a usable { name, holes, pars } — worst case, pars falls
// back to a flat array of 4s (the same default "+ Add Custom Course"
// starts you with) rather than throwing, since a bad guess here should
// never block getting into the editable pars grid to fix it by hand.
function parseHolesResponse(payload, fallbackName) {
  const name = payload?.course?.name ?? payload?.course?.course_name ?? payload?.course?.courseName ?? fallbackName;
  // Confirmed against a real third-party consumer of this API (its holes
  // are nested under `holes_data`, per-hole fields are `number`/`par`) —
  // the earlier guesses (bare `holes`) matched the array wrapper shape but
  // not this key, which is why hole *count* came through right while every
  // par silently fell back to the 4 default. Keeping the older guesses too
  // in case the two endpoints (/:id vs /:id/holes) don't wrap it the same way.
  let holeList =
    (Array.isArray(payload?.course?.holes_data) && payload.course.holes_data) ||
    (Array.isArray(payload?.holes?.holes_data) && payload.holes.holes_data) ||
    (Array.isArray(payload?.holes_data) && payload.holes_data) ||
    (Array.isArray(payload?.holes) && payload.holes) ||
    (Array.isArray(payload?.holes?.holes) && payload.holes.holes) ||
    (Array.isArray(payload?.course?.holes) && payload.course.holes) ||
    null;

  if (!holeList || holeList.length === 0) {
    console.warn("[GolfScorecard] Couldn't find a holes array in course detail response — raw payload:", payload);
    return { name, holes: 18, pars: Array(18).fill(4) };
  }

  const withNumbers = holeList.map((h, i) => ({
    num: h.number ?? h.hole ?? h.holeNumber ?? h.hole_number ?? h.index ?? i + 1,
    par: h.par ?? h.Par ?? h.holePar ?? h.hole_par ?? 4,
  }));
  if (holeList.some(h => h.par == null && h.number == null)) {
    console.warn("[GolfScorecard] Holes array found but par/number fields didn't match known keys — first hole object:", holeList[0]);
  }
  withNumbers.sort((a, b) => a.num - b.num);
  const pars = withNumbers.map(h => parseInt(h.par) || 4);
  return { name, holes: pars.length, pars };
}

export default function GolfScorecard() {
  const [selectedCourse, setSelectedCourse] = useState(() => loadJSON(CURRENT_KEY, {}).selectedCourse || "custom");
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [customCourses, setCustomCourses] = useState(() => loadJSON(CUSTOM_COURSES_KEY, {}));
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseHoles, setNewCourseHoles] = useState(18);
  const [newCoursePars, setNewCoursePars] = useState(Array(18).fill(4));

  const [p1name, setP1name] = useState(() => loadJSON(CURRENT_KEY, {}).p1name || "Player 1");
  const [p2name, setP2name] = useState(() => loadJSON(CURRENT_KEY, {}).p2name || "Player 2");
  const [scores, setScores] = useState(() => loadJSON(CURRENT_KEY, {}).scores || { p1: Array(18).fill(""), p2: Array(18).fill("") });
  const [betPerHole, setBetPerHole] = useState(() => loadJSON(CURRENT_KEY, {}).betPerHole || 1);
  // Par/birdie bonuses used to be a fixed 2x/4x multiple of betPerHole —
  // now independently settable amounts (see showBetSettings) so raising
  // the base bet doesn't silently drag the bonuses up with it. Greenie is
  // a new side bet: whoever's tee shot finishes on the green on a par 3,
  // tracked per player per hole in `greenies` below.
  const [parBonus, setParBonus] = useState(() => loadJSON(CURRENT_KEY, {}).parBonus ?? 2);
  const [birdieBonus, setBirdieBonus] = useState(() => loadJSON(CURRENT_KEY, {}).birdieBonus ?? 4);
  const [greenieBonus, setGreenieBonus] = useState(() => loadJSON(CURRENT_KEY, {}).greenieBonus ?? 2);
  const [greenies, setGreenies] = useState(() => loadJSON(CURRENT_KEY, {}).greenies || { p1: Array(18).fill(false), p2: Array(18).fill(false) });
  const [showBetSettings, setShowBetSettings] = useState(false);
  const [editingPars, setEditingPars] = useState(false);
  const [courseParOverrides, setCourseParOverrides] = useState(() => loadJSON(CURRENT_KEY, {}).courseParOverrides || {});
  const [savedRounds, setSavedRounds] = useState(() => loadJSON(ROUNDS_KEY, []));
  const [showSavedRounds, setShowSavedRounds] = useState(false);

  const [showFindCourse, setShowFindCourse] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findStateCode, setFindStateCode] = useState("");
  const [findResults, setFindResults] = useState([]);
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState("");

  const [showAlbionPicker, setShowAlbionPicker] = useState(false);
  const [albionFront, setAlbionFront] = useState("boulder");
  const [albionBack, setAlbionBack] = useState("rock");

  // Live sync — room holds { id, role: "host"|"guest" } for the shared
  // scorecard this device is in, or null if not sharing/joined. A device
  // that opens a link with ?room=<id> auto-joins as a guest (see the
  // effect below); the device that tapped "Share Scorecard" is the host.
  // Both roles can edit scores/greenies, which sync both ways; only the
  // host can change the course, pars, or bet settings — the menu below
  // hides those items entirely when isGuest.
  const [room, setRoom] = useState(() => loadJSON(ROOM_KEY, null));
  const [roomCourseInfo, setRoomCourseInfo] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [syncStatus, setSyncStatus] = useState(""); // "" | "syncing" | "synced" | "error"
  const isGuest = room?.role === "guest";
  // Timestamp of the last remote state actually applied locally — a poll
  // result older than this is our own echo (or stale), not a real update.
  const lastAppliedRemoteRef = useRef(0);
  // True for one tick right after applying a remote update, so the
  // debounced push effect (below) doesn't immediately re-push what was
  // just pulled as if it were a fresh local edit.
  const applyingRemoteRef = useRef(false);

  // Auto-join a shared scorecard from a ?room=<id> link. Only acts once
  // per distinct room id (not on every render) — joining doesn't need to
  // re-fire just because other state changed.
  React.useEffect(() => {
    const urlRoom = new URLSearchParams(window.location.search).get("room");
    if (!urlRoom || room?.id === urlRoom) return;
    const next = { id: urlRoom, role: "guest" };
    setRoom(next);
    try { localStorage.setItem(ROOM_KEY, JSON.stringify(next)); } catch {}
  }, []);

  // Persist the in-progress card on every change so a reload resumes
  // exactly where it left off — this is separate from "Save Round" below,
  // which snapshots a finished round into history.
  React.useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, JSON.stringify({ selectedCourse, p1name, p2name, scores, courseParOverrides, betPerHole, parBonus, birdieBonus, greenieBonus, greenies })); } catch {}
  }, [selectedCourse, p1name, p2name, scores, courseParOverrides, betPerHole, parBonus, birdieBonus, greenieBonus, greenies]);
  React.useEffect(() => {
    try { localStorage.setItem(CUSTOM_COURSES_KEY, JSON.stringify(customCourses)); } catch {}
  }, [customCourses]);

  const allCourses = { ...COURSES, ...customCourses };
  // Falls back to the built-in Custom Course if the restored selectedCourse
  // points at a custom course that's no longer in customCourses (e.g. its
  // own localStorage entry got cleared independently) — otherwise course
  // would be undefined and every field below would throw. A guest in a
  // shared round uses the host's synced course info instead of its own
  // local selectedCourse/allCourses lookup — the host might be playing a
  // custom or Albion-combo course the guest's device never created.
  const course = (isGuest && roomCourseInfo) ? roomCourseInfo : (allCourses[selectedCourse] || allCourses.custom);
  const holes = course.holes;
  const basePars = isGuest ? course.pars : (courseParOverrides[selectedCourse] || course.pars);
  const pars = basePars.slice(0, holes);

  // Background photo — priority order is: a photo you picked yourself via
  // the 🔍 Find Photo button (bgOverrides, below) beats a hand-picked
  // local image bundled into the app (src/assets/course-backgrounds/)
  // beats the live Wikimedia Commons auto-search (fetchCourseBackground).
  // The first two are instant/local, no network call; only the auto-
  // search path is async, guarded with a "still the current course" check
  // so a slow response for a course you've since switched away from can't
  // land late and overwrite what's now showing.
  const [bgOverrides, setBgOverrides] = useState(() => loadJSON(BG_OVERRIDE_KEY, {}));
  const [bgImage, setBgImage] = useState(null);
  React.useEffect(() => {
    let cancelled = false;
    if (bgOverrides[course.name]) { setBgImage(bgOverrides[course.name]); return; }
    const local = findCourseBackground(course.name);
    if (local) { setBgImage(local); return; }
    setBgImage(null);
    fetchCourseBackground(course.name).then(url => { if (!cancelled) setBgImage(url); });
    return () => { cancelled = true; };
  }, [course.name, bgOverrides]);

  // "🔍 Find Photo" — a per-course search-and-pick UI for when the
  // automatic Wikimedia search either found nothing or picked something
  // you don't want. bgPickerCourse holds { key, name } for whichever
  // course's row you tapped 🔍 on (null when the picker's closed).
  const [bgPickerCourse, setBgPickerCourse] = useState(null);
  const [bgCandidates, setBgCandidates] = useState([]);
  const [bgSearchLoading, setBgSearchLoading] = useState(false);

  const openBgPicker = async (key, name) => {
    setBgPickerCourse({ key, name });
    setBgCandidates([]);
    setBgSearchLoading(true);
    const results = await searchBgCandidates(name);
    setBgSearchLoading(false);
    setBgCandidates(results);
  };

  const pickBgOverride = (url) => {
    if (!bgPickerCourse) return;
    const next = { ...bgOverrides, [bgPickerCourse.name]: url };
    setBgOverrides(next);
    try { localStorage.setItem(BG_OVERRIDE_KEY, JSON.stringify(next)); } catch {}
    setBgPickerCourse(null);
  };

  // Picking a photo straight from the device (camera roll, downloads,
  // wherever) — no OS "capture" attribute, so it opens the normal photo
  // picker rather than jumping straight to the camera. This is the
  // reliable option when Wikimedia just doesn't have the course.
  const devicePhotoInputRef = useRef(null);
  const [devicePhotoLoading, setDevicePhotoLoading] = useState(false);
  const handleDevicePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again immediately
    if (!file) return;
    setDevicePhotoLoading(true);
    try {
      const dataUrl = await resizeImageFile(file, 1600);
      pickBgOverride(dataUrl);
    } catch {
      // Leaves the picker open so the user can just try again.
    }
    setDevicePhotoLoading(false);
  };

  // Applies a room's remote state to local state — used both when a poll
  // finds something newer and (implicitly, via the same shape) whenever a
  // room is first joined/started. applyingRemoteRef guards the push effect
  // below from immediately re-pushing this as if it were a fresh local
  // edit — cleared on the next tick, after React has applied the state
  // updates.
  const applyRoomState = (data) => {
    applyingRemoteRef.current = true;
    setRoomCourseInfo({ name: data.courseName, holes: data.holes, pars: data.pars, nineNames: data.nineNames || null });
    setP1name(data.p1name ?? "Player 1");
    setP2name(data.p2name ?? "Player 2");
    setScores(data.scores || { p1: Array(data.holes).fill(""), p2: Array(data.holes).fill("") });
    setGreenies(data.greenies || { p1: Array(data.holes).fill(false), p2: Array(data.holes).fill(false) });
    if (data.betPerHole != null) setBetPerHole(data.betPerHole);
    if (data.parBonus != null) setParBonus(data.parBonus);
    if (data.birdieBonus != null) setBirdieBonus(data.birdieBonus);
    if (data.greenieBonus != null) setGreenieBonus(data.greenieBonus);
    lastAppliedRemoteRef.current = data.updatedAt || Date.now();
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  };

  // Polls the room every 4s and applies whatever's there if it's newer
  // than the last thing we applied (which includes our own pushes — see
  // pushSyncRoom below setting lastAppliedRemoteRef itself). This is
  // poll-based, not true realtime — a few seconds of lag is the tradeoff
  // for not needing a websocket/push infrastructure this app doesn't have.
  React.useEffect(() => {
    if (!room) return;
    let cancelled = false;
    const poll = () => {
      fetchSyncRoom(room.id)
        .then(data => {
          if (cancelled) return;
          if (data?.updatedAt && data.updatedAt > lastAppliedRemoteRef.current) applyRoomState(data);
          setSyncStatus("synced");
        })
        .catch(() => { if (!cancelled) setSyncStatus("error"); });
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [room?.id]);

  // Pushes local state to the room ~700ms after the last edit (debounced
  // so a fast run of score taps doesn't fire a request per keystroke).
  // Skipped while applyingRemoteRef is set, so applying an incoming
  // update doesn't immediately bounce right back out as an "edit".
  React.useEffect(() => {
    if (!room || applyingRemoteRef.current) return;
    const t = setTimeout(() => {
      const payload = {
        courseName: course.name, holes, pars, nineNames: course.nineNames || null,
        p1name, p2name, scores, greenies,
        betPerHole, parBonus, birdieBonus, greenieBonus,
        updatedAt: Date.now(),
      };
      setSyncStatus("syncing");
      pushSyncRoom(room.id, payload)
        .then(() => { lastAppliedRemoteRef.current = payload.updatedAt; setSyncStatus("synced"); })
        .catch(() => setSyncStatus("error"));
    }, 700);
    return () => clearTimeout(t);
  }, [room, selectedCourse, courseParOverrides, p1name, p2name, scores, greenies, betPerHole, parBonus, birdieBonus, greenieBonus]);

  const startSharing = async () => {
    setShareLoading(true);
    setShareError("");
    try {
      const payload = {
        courseName: course.name, holes, pars, nineNames: course.nineNames || null,
        p1name, p2name, scores, greenies,
        betPerHole, parBonus, birdieBonus, greenieBonus,
        updatedAt: Date.now(),
      };
      const id = await createSyncRoom(payload);
      const next = { id, role: "host" };
      setRoom(next);
      try { localStorage.setItem(ROOM_KEY, JSON.stringify(next)); } catch {}
      lastAppliedRemoteRef.current = payload.updatedAt;
      setSyncStatus("synced");
    } catch (e) {
      setShareError(e.message || "Couldn't start sharing — try again.");
    }
    setShareLoading(false);
  };

  // Leaves the shared round without deleting it — the other device (if
  // any) keeps syncing fine; this device just stops. Also strips ?room=
  // from the URL so a reload doesn't immediately rejoin.
  const stopSharing = () => {
    setRoom(null);
    setRoomCourseInfo(null);
    setSyncStatus("");
    try { localStorage.removeItem(ROOM_KEY); } catch {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  const shareUrl = room ? window.location.origin + "/golf?room=" + room.id : "";
  const shareLink = () => {
    if (navigator.share) {
      navigator.share({ title: "⛳ Join my scorecard", text: "Join my live golf scorecard", url: shareUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
  };

  const updatePar = (hole, value) => {
    const current = courseParOverrides[selectedCourse] || [...course.pars];
    const updated = [...current];
    updated[hole] = parseInt(value) || 4;
    setCourseParOverrides({ ...courseParOverrides, [selectedCourse]: updated });
  };

  const getScore = (player, hole) => {
    const v = scores[player][hole];
    return v === "" ? null : parseInt(v);
  };

  const updateScore = (player, hole, value) => {
    const newScores = { ...scores, [player]: [...scores[player]] };
    newScores[player][hole] = value;
    setScores(newScores);
  };

  const updateGreenie = (player, hole) => {
    const next = { ...greenies, [player]: [...greenies[player]] };
    next[player][hole] = !next[player][hole];
    setGreenies(next);
  };

  const selectCourse = (key) => {
    setSelectedCourse(key);
    setScores({ p1: Array(18).fill(""), p2: Array(18).fill("") });
    setGreenies({ p1: Array(18).fill(false), p2: Array(18).fill(false) });
    setShowCourseModal(false);
  };

  // Only custom (user-added) courses can be deleted — the built-in COURSES
  // list is fixed in code, not in this state. Falls back to "custom" if the
  // course being deleted is the one currently selected.
  const deleteCustomCourse = (key) => {
    const next = { ...customCourses };
    delete next[key];
    setCustomCourses(next);
    const nextOverrides = { ...courseParOverrides };
    delete nextOverrides[key];
    setCourseParOverrides(nextOverrides);
    if (selectedCourse === key) selectCourse("custom");
  };

  // Builds an 18-hole course from any two of Albion Ridges' three nines
  // (front 9 pars + back 9 pars) and saves it as a custom course — same
  // mechanism as "Add Manually", so the result is editable (Edit Pars) and
  // deletable (🗑 in the course list) exactly like any other custom course.
  const confirmAlbionCombo = () => {
    if (albionFront === albionBack) return;
    const front = ALBION_NINES[albionFront];
    const back = ALBION_NINES[albionBack];
    const key = "albion_" + albionFront + "_" + albionBack;
    setCustomCourses({
      ...customCourses,
      [key]: {
        name: "Albion Ridges (" + front.label + " + " + back.label + ")",
        location: "Annandale, MN",
        holes: 18,
        pars: [...front.pars, ...back.pars],
        nineNames: [front.label, back.label],
      },
    });
    setShowAlbionPicker(false);
    selectCourse(key);
  };

  const saveCustomCourse = () => {
    if (!newCourseName.trim()) return;
    const key = "custom_" + Date.now();
    setCustomCourses({
      ...customCourses,
      [key]: {
        name: newCourseName.trim(),
        holes: newCourseHoles,
        pars: newCoursePars.slice(0, newCourseHoles),
      }
    });
    setShowAddCourse(false);
    setNewCourseName("");
    setNewCoursePars(Array(18).fill(4));
    selectCourse(key);
  };

  // Course search (OpenGolfAPI via api/golfcourses.js) — results feed into
  // the same "Add Custom Course" form/grid used for manual entry, so
  // whatever comes back is always reviewable/editable before it's saved
  // rather than trusted blindly.
  const searchCourses = async () => {
    if (findQuery.trim().length < 2) { setFindError("Type at least 2 characters"); return; }
    setFindLoading(true);
    setFindError("");
    try {
      const params = new URLSearchParams({ action: "search", q: findQuery.trim() });
      if (findStateCode.trim()) params.set("state", findStateCode.trim());
      const r = await fetch("/api/golfcourses?" + params.toString());
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Search failed");
      const rows = Array.isArray(data) ? data : data.results || data.courses || [];
      setFindResults(rows.map(parseSearchResult));
      if (rows.length === 0) setFindError("No courses found — try a shorter name or drop the state.");
    } catch (e) {
      setFindError(e.message || "Search failed");
      setFindResults([]);
    } finally {
      setFindLoading(false);
    }
  };

  const pickCourseResult = async (result) => {
    setFindLoading(true);
    setFindError("");
    try {
      const r = await fetch("/api/golfcourses?" + new URLSearchParams({ action: "detail", id: result.id }));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't load that course");
      const { name, holes: h, pars: p } = parseHolesResponse(data, result.name);
      const clampedHoles = Math.min(h, 18) || 18;
      setNewCourseName(name);
      setNewCourseHoles(clampedHoles);
      setNewCoursePars(Array.from({ length: 18 }, (_, i) => p[i] || 4));
      setShowFindCourse(false);
      setFindQuery(""); setFindResults([]);
      setShowAddCourse(true);
    } catch (e) {
      setFindError(e.message || "Couldn't load that course — try entering it manually.");
    } finally {
      setFindLoading(false);
    }
  };

  const calcBetting = () => {
    let carryover = 0;
    let p1money = 0;
    let p2money = 0;
    let p1wins = 0;
    let p2wins = 0;
    let results = [];

    for (let i = 0; i < holes; i++) {
      const s1 = getScore("p1", i);
      const s2 = getScore("p2", i);
      const par = pars[i];
      const pot = betPerHole + carryover;

      // Greenie — a par-3-only side bet for whoever's tee shot actually
      // finished on the green, independent of the hole's final score
      // below. Only pays if exactly one player got it; both (or neither)
      // is a push, same as any other tie, and it's evaluated regardless of
      // whether scores have been entered yet since it's marked right after
      // the tee shot, before the hole is finished.
      let greenieWinner = null, greenieAmt = 0;
      if (par === 3) {
        const g1 = !!greenies.p1[i], g2 = !!greenies.p2[i];
        if (g1 && !g2) { greenieWinner = 1; greenieAmt = greenieBonus; p1money += greenieAmt; p2money -= greenieAmt; }
        else if (g2 && !g1) { greenieWinner = 2; greenieAmt = greenieBonus; p2money += greenieAmt; p1money -= greenieAmt; }
      }

      if (s1 === null || s2 === null) {
        results.push({ winner: null, pot, carryover, par, greenieWinner, greenieAmt });
        continue;
      }

      if (s1 < s2) {
        let bonus = 0;
        if (s1 <= par - 1) bonus = birdieBonus;
        else if (s1 === par) bonus = parBonus;
        const winAmount = pot + bonus;
        p1money += winAmount;
        p2money -= winAmount;
        p1wins++;
        results.push({ winner: 1, amount: winAmount, pot, carryover, bonus, s1, s2, par, greenieWinner, greenieAmt });
        carryover = 0;
      } else if (s2 < s1) {
        let bonus = 0;
        if (s2 <= par - 1) bonus = birdieBonus;
        else if (s2 === par) bonus = parBonus;
        const winAmount = pot + bonus;
        p2money += winAmount;
        p1money -= winAmount;
        p2wins++;
        results.push({ winner: 2, amount: winAmount, pot, carryover, bonus, s1, s2, par, greenieWinner, greenieAmt });
        carryover = 0;
      } else {
        carryover += betPerHole;
        results.push({ winner: 0, pot, carryover, s1, s2, par, greenieWinner, greenieAmt });
      }
    }

    return { p1money, p2money, p1wins, p2wins, results, carryover };
  };

  const resetScores = () => {
    setScores({ p1: Array(18).fill(""), p2: Array(18).fill("") });
    setGreenies({ p1: Array(18).fill(false), p2: Array(18).fill(false) });
  };

  const { p1money, p2money, p1wins, p2wins, results, carryover } = calcBetting();
  const moneyColor = v => v > 0 ? "#27500A" : v < 0 ? "#A32D2D" : "#888";
  const playedHoles = results.filter(r => r.s1 !== undefined && r.s1 !== null).length;

  // Snapshots the live card into a plain object independent of the COURSES
  // lookup / selectedCourse key — so a saved round still renders and texts
  // correctly even if the course it was played on gets edited or removed
  // later. Used both for "Save Round" (persisted) and "Text" on the live
  // card (built fresh, never persisted).
  const currentSnapshot = () => ({
    id: null,
    date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    courseName: course.name,
    holes, pars, betPerHole, parBonus, birdieBonus, greenieBonus,
    p1name, p2name,
    scores: { p1: scores.p1.slice(0, holes), p2: scores.p2.slice(0, holes) },
    greenies: { p1: greenies.p1.slice(0, holes), p2: greenies.p2.slice(0, holes) },
    results: results.slice(0, holes),
    p1money, p2money, p1wins, p2wins, carryover,
  });

  const saveRound = () => {
    const snapshot = { ...currentSnapshot(), id: Date.now() };
    const next = [snapshot, ...savedRounds];
    setSavedRounds(next);
    try { localStorage.setItem(ROUNDS_KEY, JSON.stringify(next)); } catch {}
    setShowSavedRounds(true);
  };

  const deleteRound = (id) => {
    const next = savedRounds.filter(r => r.id !== id);
    setSavedRounds(next);
    try { localStorage.setItem(ROUNDS_KEY, JSON.stringify(next)); } catch {}
  };

  const front9 = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back9 = holes > 9 ? Array.from({ length: holes - 9 }, (_, i) => i + 9) : [];
  // A combo course built by the Albion picker (or any future course with
  // named nines) shows the actual nine name here instead of the generic
  // "Front 9"/"Back 9" label.
  const front9Label = course.nineNames?.[0] ? course.nineNames[0] + " Nine" : "Front 9";
  const back9Label = course.nineNames?.[1] ? course.nineNames[1] + " Nine" : "Back 9";

  const holeTotal = (player, from, to) =>
    scores[player].slice(from, to).reduce((a, v) => a + (v === "" ? 0 : parseInt(v)), 0);
  const parTotal = (from, to) => pars.slice(from, to).reduce((a, v) => a + v, 0);

  const renderHoleRows = (holeIndices) => holeIndices.map(i => {
    const r = results[i] || { winner: null, pot: 1, carryover: 0 };
    const isPar3 = pars[i] === 3;
    let resultEl = null;
    if (r.winner === 1) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#EAF3DE", color: "#27500A" } },
        p1name + " +$" + r.amount + (r.bonus > 0 ? (r.s1 <= r.par - 1 ? " 🦅" : " par!") : "")
      );
    } else if (r.winner === 2) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#EAF3DE", color: "#27500A" } },
        p2name + " +$" + r.amount + (r.bonus > 0 ? (r.s2 <= r.par - 1 ? " 🦅" : " par!") : "")
      );
    } else if (r.winner === 0) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#FAEEDA", color: "#633806" } },
        "Carry →$" + r.carryover
      );
    }
    let greenieEl = null;
    if (r.greenieWinner === 1) {
      greenieEl = React.createElement("div", { style: { fontSize: 10, color: "#27500A", marginTop: 3 } }, "🟢 " + p1name + " +$" + r.greenieAmt);
    } else if (r.greenieWinner === 2) {
      greenieEl = React.createElement("div", { style: { fontSize: 10, color: "#27500A", marginTop: 3 } }, "🟢 " + p2name + " +$" + r.greenieAmt);
    }
    return React.createElement("tr", { key: i, style: styles.tr },
      React.createElement("td", { style: styles.td }, React.createElement("span", { style: styles.holeNum }, i + 1)),
      React.createElement("td", { style: styles.td },
        editingPars
          ? React.createElement("input", { style: { ...styles.scoreInput, width: 36 }, type: "number", min: 3, max: 6, value: pars[i], onChange: e => updatePar(i, e.target.value) })
          : React.createElement("span", { style: { ...styles.photoText, fontSize: 13, fontWeight: 600 } }, pars[i])
      ),
      React.createElement("td", { style: styles.td },
        React.createElement("div", { style: styles.scoreCell },
          React.createElement("input", { style: styles.scoreInput, type: "number", min: 1, max: 15, value: scores.p1[i], onChange: e => updateScore("p1", i, e.target.value) }),
          React.createElement("button", {
            onClick: () => updateGreenie("p1", i),
            title: "Greenie — hit the green from the tee box",
            // Rendered on every row (not just par 3s) so its reserved
            // space keeps every score box lined up in the same column —
            // just invisible and untappable where it doesn't apply.
            style: { ...styles.greenieBtn, ...(isPar3 ? {} : { visibility: "hidden", pointerEvents: "none" }), ...(greenies.p1[i] ? styles.greenieBtnActive : {}) },
          }, "🟢")
        )
      ),
      React.createElement("td", { style: styles.td },
        React.createElement("div", { style: styles.scoreCell },
          React.createElement("input", { style: styles.scoreInput, type: "number", min: 1, max: 15, value: scores.p2[i], onChange: e => updateScore("p2", i, e.target.value) }),
          React.createElement("button", {
            onClick: () => updateGreenie("p2", i),
            title: "Greenie — hit the green from the tee box",
            style: { ...styles.greenieBtn, ...(isPar3 ? {} : { visibility: "hidden", pointerEvents: "none" }), ...(greenies.p2[i] ? styles.greenieBtnActive : {}) },
          }, "🟢")
        )
      ),
      React.createElement("td", { style: { ...styles.td, minWidth: 130 } }, resultEl, greenieEl),
      React.createElement("td", { style: { ...styles.td, ...styles.photoText, fontSize: 11, fontWeight: 600 } }, "$" + r.pot)
    );
  });

  const pageStyle = bgImage
    ? { ...styles.page, backgroundImage: "url('" + bgImage + "')" }
    : styles.page;

  return React.createElement("div", { style: pageStyle },
    React.createElement("div", { style: styles.contentCard },

    // Course selector modal
    showCourseModal && React.createElement("div", { style: styles.overlay, onClick: () => setShowCourseModal(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Select Course"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowCourseModal(false) }, "×")
        ),
        React.createElement("div", {
          style: { ...styles.courseRow, background: "#FFF8E8" },
          onClick: () => { setShowAlbionPicker(true); setShowCourseModal(false); },
        },
          React.createElement("div", { style: styles.courseName }, "⛳ Albion Ridges — pick 2 nines"),
          React.createElement("div", { style: styles.courseMeta }, "27-hole course — choose which 2 of Boulder/Rock/Granite for an 18-hole round")
        ),
        Object.entries(allCourses).map(([key, c]) =>
          React.createElement("div", { key, style: { ...styles.courseRow, ...(key === selectedCourse ? styles.courseRowActive : {}), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }, onClick: () => selectCourse(key) },
            React.createElement("div", { style: { minWidth: 0 } },
              React.createElement("div", { style: styles.courseName }, c.name),
              React.createElement("div", { style: styles.courseMeta }, (c.location || "") + (c.location ? " · " : "") + c.holes + " holes · Par " + c.pars.slice(0, c.holes).reduce((a, v) => a + v, 0))
            ),
            React.createElement("button", {
              style: { ...styles.iconBtn, color: "#185FA5", flexShrink: 0 },
              title: "Find a background photo for this course",
              onClick: (e) => { e.stopPropagation(); openBgPicker(key, c.name); },
            }, "🔍"),
            customCourses[key] && React.createElement("button", {
              style: { ...styles.iconBtn, color: "#A32D2D", flexShrink: 0 },
              title: "Delete this course",
              onClick: (e) => { e.stopPropagation(); deleteCustomCourse(key); },
            }, "🗑")
          )
        ),
        React.createElement("div", { style: { padding: "0.75rem 1.25rem", borderTop: "0.5px solid #e0e0e0", display: "flex", gap: 8 } },
          React.createElement("button", { style: { ...styles.btn, flex: 1, textAlign: "center", background: "#185FA5", color: "#fff", border: "none" }, onClick: () => { setShowFindCourse(true); setShowCourseModal(false); } }, "🔍 Find Course"),
          React.createElement("button", { style: { ...styles.btn, flex: 1, textAlign: "center" }, onClick: () => { setShowAddCourse(true); setShowCourseModal(false); } }, "+ Add Manually")
        )
      )
    ),

    // Find-photo picker — searches Wikimedia Commons for the course the 🔍
    // button was tapped on and shows every candidate as a grid, so you can
    // pick the one you actually want instead of trusting whatever the
    // automatic single-best-guess search landed on (or getting nothing at
    // all for a course Commons doesn't have indexed under the obvious
    // name). Picking one saves it to bgOverrides, which always wins over
    // both the bundled local image and the automatic search.
    bgPickerCourse && React.createElement("div", { style: styles.overlay, onClick: () => setBgPickerCourse(null) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Photo for " + bgPickerCourse.name),
          React.createElement("button", { style: styles.modalClose, onClick: () => setBgPickerCourse(null) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          // Device photo — the reliable option, since Wikimedia just
          // doesn't have most small local courses.
          React.createElement("input", { ref: devicePhotoInputRef, type: "file", accept: "image/*", style: { display: "none" }, onChange: handleDevicePhotoChange }),
          React.createElement("button", {
            style: { ...styles.btn, width: "100%", textAlign: "center", background: "#185FA5", color: "#fff", border: "none", marginBottom: 4 },
            disabled: devicePhotoLoading,
            onClick: () => devicePhotoInputRef.current?.click(),
          }, devicePhotoLoading ? "Processing..." : "📁 Choose Photo from Device"),
          React.createElement("div", { style: { textAlign: "center", fontSize: 11, color: "#888", margin: "8px 0" } }, "— or pick from Wikimedia Commons —"),
          bgSearchLoading
            ? React.createElement("div", { style: { textAlign: "center", color: "#888", fontSize: 14, padding: "1.5rem 0" } }, "Searching Wikimedia Commons...")
            : bgCandidates.length === 0
              ? React.createElement("div", { style: { textAlign: "center", color: "#888", fontSize: 14, padding: "1.5rem 0" } }, "No photos found for this course on Wikimedia Commons.")
              : React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 } },
                  bgCandidates.map((c, i) => React.createElement("img", {
                    key: i, src: c.thumb, alt: "", onClick: () => pickBgOverride(c.full),
                    style: { width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, cursor: "pointer", border: "1px solid #e0e0e0" },
                  }))
                )
        )
      )
    ),

    // Albion Ridges nine-picker — builds an 18-hole course from any two of
    // its three nines (see confirmAlbionCombo) rather than pre-listing all
    // six possible combos as separate rows in the main course list.
    showAlbionPicker && React.createElement("div", { style: styles.overlay, onClick: () => setShowAlbionPicker(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Albion Ridges — Pick 2 Nines"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowAlbionPicker(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Front 9"),
            React.createElement("select", { style: styles.input, value: albionFront, onChange: e => setAlbionFront(e.target.value) },
              Object.entries(ALBION_NINES).map(([k, n]) => React.createElement("option", { key: k, value: k }, n.label + " Nine"))
            )
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Back 9"),
            React.createElement("select", { style: styles.input, value: albionBack, onChange: e => setAlbionBack(e.target.value) },
              Object.entries(ALBION_NINES).map(([k, n]) => React.createElement("option", { key: k, value: k }, n.label + " Nine"))
            )
          ),
          albionFront === albionBack && React.createElement("div", { style: { fontSize: 12, color: "#A32D2D", marginBottom: 8 } }, "Front and back must be different nines."),
          React.createElement("button", {
            style: { ...styles.btn, background: albionFront === albionBack ? "#ccc" : "#185FA5", color: "#fff", border: "none", width: "100%", textAlign: "center" },
            disabled: albionFront === albionBack,
            onClick: confirmAlbionCombo,
          }, "Play This Combo")
        )
      )
    ),

    // Bet settings — $/hole plus the par/birdie/greenie bonus amounts.
    // These used to be fixed multiples of betPerHole (2x/4x); now they're
    // independently settable so raising the base bet doesn't drag them up.
    showBetSettings && React.createElement("div", { style: styles.overlay, onClick: () => setShowBetSettings(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Bet Settings"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowBetSettings(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "$ per hole"),
            React.createElement("input", { style: styles.input, type: "number", min: 0, step: 1, value: betPerHole, onChange: e => setBetPerHole(Math.max(0, parseInt(e.target.value) || 0)) })
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "$ bonus for winning with par"),
            React.createElement("input", { style: styles.input, type: "number", min: 0, step: 1, value: parBonus, onChange: e => setParBonus(Math.max(0, parseInt(e.target.value) || 0)) })
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "$ bonus for winning with birdie or better"),
            React.createElement("input", { style: styles.input, type: "number", min: 0, step: 1, value: birdieBonus, onChange: e => setBirdieBonus(Math.max(0, parseInt(e.target.value) || 0)) })
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "$ for a greenie (tee shot on the green, par 3s only)"),
            React.createElement("input", { style: styles.input, type: "number", min: 0, step: 1, value: greenieBonus, onChange: e => setGreenieBonus(Math.max(0, parseInt(e.target.value) || 0)) })
          ),
          React.createElement("button", { style: { ...styles.btn, background: "#185FA5", color: "#fff", width: "100%", textAlign: "center", marginTop: 4 }, onClick: () => setShowBetSettings(false) }, "Done")
        )
      )
    ),

    // Find course modal — searches OpenGolfAPI and, on pick, hands off to
    // the Add Custom Course form pre-filled so the pars are always
    // reviewable/editable before saving (see pickCourseResult's comment).
    showFindCourse && React.createElement("div", { style: styles.overlay, onClick: () => setShowFindCourse(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Find Course"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowFindCourse(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8 } },
            React.createElement("input", {
              style: { ...styles.input, flex: 1 }, type: "text", placeholder: "Course name",
              value: findQuery, onChange: e => setFindQuery(e.target.value),
              onKeyDown: e => { if (e.key === "Enter") searchCourses(); },
            }),
            React.createElement("input", {
              style: { ...styles.input, width: 60, textAlign: "center" }, type: "text", placeholder: "St", maxLength: 2,
              value: findStateCode, onChange: e => setFindStateCode(e.target.value.toUpperCase()),
              onKeyDown: e => { if (e.key === "Enter") searchCourses(); },
            })
          ),
          React.createElement("button", { style: { ...styles.btn, width: "100%", textAlign: "center", background: "#185FA5", color: "#fff", border: "none", marginBottom: 8 }, onClick: searchCourses, disabled: findLoading }, findLoading ? "Searching..." : "Search"),
          findError && React.createElement("div", { style: { fontSize: 13, color: "#A32D2D", marginBottom: 8 } }, findError),
          findResults.map(res =>
            React.createElement("div", { key: res.id, style: styles.courseRow, onClick: () => pickCourseResult(res) },
              React.createElement("div", { style: styles.courseName }, res.name),
              React.createElement("div", { style: styles.courseMeta }, [res.city, res.state].filter(Boolean).join(", "))
            )
          )
        )
      )
    ),

    // Add custom course modal
    showAddCourse && React.createElement("div", { style: styles.overlay, onClick: () => setShowAddCourse(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Add Custom Course"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowAddCourse(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Course name"),
            React.createElement("input", { style: styles.input, type: "text", placeholder: "e.g. Elk River Golf Club", value: newCourseName, onChange: e => setNewCourseName(e.target.value) })
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Number of holes"),
            React.createElement("select", { style: styles.input, value: newCourseHoles, onChange: e => { const h = parseInt(e.target.value); setNewCourseHoles(h); setNewCoursePars(Array(h).fill(4)); } },
              React.createElement("option", { value: 9 }, "9 holes"),
              React.createElement("option", { value: 18 }, "18 holes")
            )
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Par for each hole"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 } },
              Array.from({ length: newCourseHoles }, (_, i) =>
                React.createElement("div", { key: i, style: { textAlign: "center" } },
                  React.createElement("div", { style: { fontSize: 10, color: "#888", marginBottom: 2 } }, i + 1),
                  React.createElement("input", { style: { ...styles.scoreInput, width: "100%", fontSize: 13 }, type: "number", min: 3, max: 6, value: newCoursePars[i], onChange: e => { const p = [...newCoursePars]; p[i] = parseInt(e.target.value) || 4; setNewCoursePars(p); } })
                )
              )
            )
          ),
          React.createElement("button", { style: { ...styles.btn, background: "#185FA5", color: "#fff", width: "100%", textAlign: "center", marginTop: 8 }, onClick: saveCustomCourse }, "Save Course")
        )
      )
    ),

    // Header — hamburger nav holds every action button (bet settings,
    // saved rounds, text, save, edit pars, reset, restart); the course
    // name itself is the page's H1, in a display font, and is still the
    // "switch course" control — tap it to open the picker, same as the
    // old small pill button did. Hamburger sits on the same row as the
    // heading, at the right, rather than its own row above it.
    React.createElement("div", { style: styles.header },
      React.createElement("h1", {
        style: isGuest ? { ...styles.courseHeading, cursor: "default" } : styles.courseHeading,
        onClick: () => { if (!isGuest) setShowCourseModal(true); },
      }, course.name + (isGuest ? "" : " ▾")),
      React.createElement("button", { style: styles.hamburgerBtn, onClick: () => setMenuOpen(true) },
        React.createElement("span", { style: styles.hamburgerLine }),
        React.createElement("span", { style: styles.hamburgerLine }),
        React.createElement("span", { style: styles.hamburgerLine })
      )
    ),

    // Hamburger nav drawer — a guest in a shared round doesn't get
    // Bet Settings or Edit Pars (those stay under the host's control so
    // two devices can't fork the round's setup out from under each
    // other); everything else, including entering scores, is the same
    // either way.
    menuOpen && React.createElement("div", { style: styles.menuOverlay, onClick: () => setMenuOpen(false) },
      React.createElement("div", { style: styles.menuDrawer, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.menuHeader },
          React.createElement("div", { style: styles.menuTitle }, "Menu"),
          React.createElement("button", { style: styles.menuClose, onClick: () => setMenuOpen(false) }, "×")
        ),
        React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); setShowShareModal(true); } },
          "📤 Share Scorecard" + (room ? (isGuest ? " (joined)" : " (sharing)") : "")
        ),
        !isGuest && React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); setShowBetSettings(true); } }, "⚙️ Bet Settings — $" + betPerHole + "/hole"),
        React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); setShowSavedRounds(true); } }, "📋 Saved Rounds (" + savedRounds.length + ")"),
        React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); shareScorecard(currentSnapshot()); } }, "📱 Text Scorecard"),
        React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); saveRound(); } }, "💾 Save Round"),
        !isGuest && React.createElement("button", { style: styles.menuItem, onClick: () => { setMenuOpen(false); setEditingPars(!editingPars); } }, editingPars ? "✓ Done Editing Pars" : "✏️ Edit Pars"),
        !isGuest && React.createElement("button", { style: { ...styles.menuItem, color: "#A32D2D" }, onClick: () => { setMenuOpen(false); resetScores(); } }, "↺ Reset Scores"),
        // Full page reload — separate from Reset (which only clears
        // scores/greenies). Everything this page needs survives a reload
        // (localStorage), so this is just a plain, unconditional refresh,
        // useful for recovering from a stuck UI state or picking up a
        // just-deployed update.
        React.createElement("button", { style: styles.menuItem, onClick: () => window.location.reload() }, "🔄 Restart App"),
        React.createElement("div", { style: styles.menuVersion }, "TechPortal Golf v" + GOLF_VERSION)
      )
    ),

    // Share Scorecard modal — starting a share (host) creates a room and
    // opens the native share sheet with the join link; joining a room
    // (guest, via that link) skips straight to the "already sharing" view.
    // Sync status line reflects the poll/push loop above.
    showShareModal && React.createElement("div", { style: styles.overlay, onClick: () => setShowShareModal(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Share Scorecard"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowShareModal(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          !room
            ? React.createElement(React.Fragment, null,
                React.createElement("div", { style: { fontSize: 13, color: "#666", marginBottom: 12, lineHeight: 1.5 } },
                  "Share a live link with the player you're playing with — scores and greenies sync between both phones as you play (a few seconds of lag, not instant). They can enter scores too; the course and bet settings stay under your control."
                ),
                shareError && React.createElement("div", { style: { fontSize: 13, color: "#A32D2D", marginBottom: 8 } }, shareError),
                React.createElement("button", {
                  style: { ...styles.btn, width: "100%", textAlign: "center", background: "#185FA5", color: "#fff", border: "none" },
                  disabled: shareLoading, onClick: startSharing,
                }, shareLoading ? "Starting..." : "Start Sharing")
              )
            : React.createElement(React.Fragment, null,
                React.createElement("div", { style: { fontSize: 13, color: "#666", marginBottom: 4 } },
                  isGuest ? "You've joined a shared scorecard." : "Sharing this scorecard."
                ),
                React.createElement("div", { style: { fontSize: 12, color: syncStatus === "error" ? "#A32D2D" : "#27500A", marginBottom: 12 } },
                  syncStatus === "error" ? "⚠ Sync error — will keep retrying" : syncStatus === "syncing" ? "Syncing..." : "🟢 Synced"
                ),
                !isGuest && React.createElement(React.Fragment, null,
                  React.createElement("div", { style: { ...styles.input, marginBottom: 8, wordBreak: "break-all", fontSize: 12, color: "#666" } }, shareUrl),
                  React.createElement("button", { style: { ...styles.btn, width: "100%", textAlign: "center", background: "#185FA5", color: "#fff", border: "none", marginBottom: 8 }, onClick: shareLink }, "📤 Share Link")
                ),
                React.createElement("button", {
                  style: { ...styles.btn, width: "100%", textAlign: "center", color: "#A32D2D" },
                  onClick: () => { stopSharing(); setShowShareModal(false); },
                }, isGuest ? "Leave Shared Scorecard" : "Stop Sharing")
              )
        )
      )
    ),

    // Saved rounds modal
    showSavedRounds && React.createElement("div", { style: styles.overlay, onClick: () => setShowSavedRounds(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Saved Rounds"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowSavedRounds(false) }, "×")
        ),
        savedRounds.length === 0
          ? React.createElement("div", { style: { padding: "2rem 1.25rem", textAlign: "center", color: "#888", fontSize: 14 } }, "No saved rounds yet — tap \"Save Round\" after a round to keep it here.")
          : savedRounds.map(r =>
              React.createElement("div", { key: r.id, style: styles.savedRoundRow },
                React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: styles.savedRoundTitle }, r.courseName),
                  React.createElement("div", { style: styles.courseMeta }, r.date + " · " + r.p1name + " " + fmt(r.p1money) + "  ·  " + r.p2name + " " + fmt(r.p2money))
                ),
                React.createElement("button", { style: styles.iconBtn, title: "Text this scorecard", onClick: () => shareScorecard(r) }, "📱"),
                React.createElement("button", { style: { ...styles.iconBtn, color: "#A32D2D" }, title: "Delete", onClick: () => deleteRound(r.id) }, "🗑")
              )
            )
      )
    ),

    // Player cards
    React.createElement("div", { style: styles.playerGrid },
      React.createElement("div", { style: styles.playerCard },
        React.createElement("input", { style: styles.nameInput, value: p1name, onChange: e => setP1name(e.target.value) }),
        React.createElement("div", { style: { fontSize: 28, fontWeight: 500, color: moneyColor(p1money) } }, fmt(p1money)),
        React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, p1wins + " hole" + (p1wins !== 1 ? "s" : "") + " won")
      ),
      React.createElement("div", { style: styles.playerCard },
        React.createElement("input", { style: styles.nameInput, value: p2name, onChange: e => setP2name(e.target.value) }),
        React.createElement("div", { style: { fontSize: 28, fontWeight: 500, color: moneyColor(p2money) } }, fmt(p2money)),
        React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, p2wins + " hole" + (p2wins !== 1 ? "s" : "") + " won")
      )
    ),

    carryover > 0 && React.createElement("div", { style: styles.carryBanner },
      "⚡ Active carryover: $" + carryover + " rolls into next hole"
    ),

    // Front 9
    React.createElement("div", { style: styles.tableWrap },
      React.createElement("div", { style: styles.sectionLabel }, front9Label),
      React.createElement("table", { style: styles.table },
        React.createElement("thead", null,
          React.createElement("tr", null,
            ["Hole","Par",p1name,p2name,"Result","Pot"].map(h => React.createElement("th", { key: h, style: styles.th }, h))
          )
        ),
        React.createElement("tbody", null, renderHoleRows(front9)),
        React.createElement("tfoot", null,
          React.createElement("tr", { style: { background: "#f5f5f3" } },
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, "OUT"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, parTotal(0, 9)),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p1", 0, 9) || "-"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p2", 0, 9) || "-"),
            React.createElement("td", { style: styles.td }),
            React.createElement("td", { style: styles.td })
          )
        )
      )
    ),

    // Back 9
    back9.length > 0 && React.createElement("div", { style: styles.tableWrap },
      React.createElement("div", { style: styles.sectionLabel }, back9Label),
      React.createElement("table", { style: styles.table },
        React.createElement("thead", null,
          React.createElement("tr", null,
            ["Hole","Par",p1name,p2name,"Result","Pot"].map(h => React.createElement("th", { key: h, style: styles.th }, h))
          )
        ),
        React.createElement("tbody", null, renderHoleRows(back9)),
        React.createElement("tfoot", null,
          React.createElement("tr", { style: { background: "#f5f5f3" } },
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, "IN"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, parTotal(9, 18)),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p1", 9, 18) || "-"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p2", 9, 18) || "-"),
            React.createElement("td", { style: styles.td }),
            React.createElement("td", { style: styles.td })
          )
        )
      )
    ),

    // Summary
    playedHoles > 0 && React.createElement("div", { style: styles.summary },
      React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, "Holes played"),
        React.createElement("span", { style: styles.summaryVal }, playedHoles + " / " + holes)
      ),
      React.createElement("div", { style: { ...styles.summaryRow, borderTop: "0.5px solid #e0e0e0", paddingTop: 8, marginTop: 4 } },
        React.createElement("span", { style: styles.summaryLabel }, p1name),
        React.createElement("span", { style: { fontWeight: 500, color: moneyColor(p1money) } }, fmt(p1money))
      ),
      React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, p2name),
        React.createElement("span", { style: { fontWeight: 500, color: moneyColor(p2money) } }, fmt(p2money))
      ),
      carryover > 0 && React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, "Outstanding carryover"),
        React.createElement("span", { style: styles.summaryVal }, "$" + carryover)
      )
    )
    )
  );
}
const styles = {
  // Full-bleed background photo (set dynamically per course, see bgImage)
  // sits behind everything, shown at full brightness/clarity — no tint, no
  // blur, no dimming overlay.
  page: { fontFamily: "system-ui, sans-serif", minHeight: "100vh", backgroundColor: "#f5f5f3", backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" },
  // No background of its own — just layout (width/margin/padding).
  // Legibility over the untouched photo comes from textShadow here, which
  // (being an inherited CSS property) cascades to every plain text node
  // inside without needing a wash behind them: a soft white glow around
  // dark text keeps it readable regardless of what's directly behind it.
  // Buttons/inputs/tables already carry their own solid backgrounds, so
  // they're unaffected and stay exactly as legible as before. Kept
  // deliberately subtle (low alpha, small blur) — too strong and it reads
  // as a thick white outline instead of a soft legibility assist.
  contentCard: { maxWidth: 680, margin: "0 auto", padding: "1rem", paddingBottom: "3rem", textShadow: "0 0 3px rgba(255,255,255,0.55), 0 1px 2px rgba(255,255,255,0.65)" },
  // Course name (H1) and the hamburger button share this row, heading on
  // the left and nav on the right, rather than the hamburger getting its
  // own row above.
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: "1rem" },
  // Playfair Display (loaded in index.html) instead of the body's
  // system-ui, so it reads like actual course signage rather than another
  // line of UI text. Still the tap target for switching courses, same as
  // the small pill button it replaced.
  courseHeading: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: "clamp(24px, 7vw, 36px)", fontWeight: 900, color: "#1a1a1a", margin: 0, cursor: "pointer", lineHeight: 1.15 },
  hamburgerBtn: { flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: "4px 6px", display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" },
  hamburgerLine: { display: "block", width: 22, height: 2, background: "#333", borderRadius: 2 },
  menuOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 },
  menuDrawer: { position: "absolute", top: 0, left: 0, bottom: 0, width: 270, maxWidth: "80vw", background: "#fff", boxShadow: "4px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", overflowY: "auto" },
  menuHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.25rem 1rem", borderBottom: "0.5px solid #e0e0e0" },
  menuTitle: { fontSize: 16, fontWeight: 700, color: "#1a1a1a" },
  menuClose: { fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#888" },
  menuItem: { display: "block", width: "100%", textAlign: "left", padding: "0.85rem 1.25rem", fontSize: 14, color: "#1a1a1a", background: "none", border: "none", borderBottom: "0.5px solid #f0f0f0", cursor: "pointer", fontFamily: "system-ui, sans-serif", fontWeight: 500 },
  menuVersion: { padding: "0.85rem 1.25rem", fontSize: 11, color: "#aaa", marginTop: "auto" },
  btn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", cursor: "pointer", color: "#1a1a1a" },
  playerGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1rem" },
  playerCard: { background: "#f5f5f3", borderRadius: 12, padding: "12px 16px" },
  nameInput: { background: "none", border: "none", borderBottom: "0.5px solid #ccc", fontSize: 14, fontWeight: 500, color: "#1a1a1a", width: "100%", outline: "none", marginBottom: 6, padding: "2px 0" },
  carryBanner: { background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: "1rem" },
  tableWrap: { marginBottom: "1.5rem" },
  // Gray text with only the light glow (inherited from contentCard) was
  // unreadable directly on the photo — switched to white with its own
  // dark shadow instead. A light glow can't help white text (there's
  // nothing to contrast against on light parts of the photo), so this
  // overrides the inherited textShadow rather than stacking onto it.
  photoText: { color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)" },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)" },
  table: { width: "100%", borderCollapse: "collapse" },
  // textShadow: none overrides the inherited photo-legibility glow — this
  // sits on a solid, fully-opaque background already, so the glow just
  // added a blurry halo around white-on-blue text for no reason.
  th: { background: "#185FA5", color: "white", padding: "7px 6px", textAlign: "center", fontSize: 12, fontWeight: 500, textShadow: "none" },
  tr: { borderBottom: "0.5px solid #e0e0e0" },
  td: { padding: "5px 4px", textAlign: "center", fontSize: 13 },
  holeNum: { fontSize: 12, fontWeight: 600, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)" },
  scoreInput: { width: 40, height: 32, textAlign: "center", fontSize: 14, fontWeight: 500, border: "0.5px solid #ccc", borderRadius: 6, background: "#fff", color: "#1a1a1a" },
  scoreCell: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4 },
  greenieBtn: { flexShrink: 0, width: 22, height: 22, fontSize: 11, lineHeight: "20px", padding: 0, borderRadius: "50%", border: "1px solid #ccc", background: "#fff", opacity: 0.4, cursor: "pointer" },
  greenieBtnActive: { opacity: 1, border: "1px solid #27500A", background: "#EAF3DE" },
  badge: { fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap" },
  summary: { background: "#f5f5f3", borderRadius: 12, padding: "1rem" },
  summaryRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" },
  summaryLabel: { color: "#888" },
  summaryVal: { fontWeight: 500, color: "#1a1a1a" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  modalTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" },
  modalClose: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888" },
  courseRow: { padding: "0.85rem 1.25rem", borderBottom: "0.5px solid #f0f0f0", cursor: "pointer" },
  courseRowActive: { background: "#f0f4ff" },
  courseName: { fontSize: 14, fontWeight: 500, color: "#1a1a1a", marginBottom: 2 },
  courseMeta: { fontSize: 12, color: "#888" },
  fieldGroup: { marginBottom: "0.75rem" },
  fieldLabel: { fontSize: 12, color: "#888", display: "block", marginBottom: 4 },
  input: { width: "100%", padding: "9px 12px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 8, background: "#fff", color: "#1a1a1a", boxSizing: "border-box" },
  savedRoundRow: { display: "flex", alignItems: "center", gap: 8, padding: "0.75rem 1.25rem", borderBottom: "0.5px solid #f0f0f0" },
  savedRoundTitle: { fontSize: 14, fontWeight: 500, color: "#1a1a1a", marginBottom: 2 },
  iconBtn: { fontSize: 16, background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: "#185FA5" },
};
