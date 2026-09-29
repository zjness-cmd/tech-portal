import React, { useState } from "react";
import { findCourseBackground } from "../clientAssets";

// Bump on every user-visible change to this file, independent of
// Dashboard.jsx's own APP_VERSION — this page is a standalone feature
// (see CLAUDE.md) with its own change history. Shown as a small badge next
// to the page title.
const GOLF_VERSION = "1.2.0";

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

function loadJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
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
  // would be undefined and every field below would throw.
  const course = allCourses[selectedCourse] || allCourses.custom;
  const holes = course.holes;
  const basePars = courseParOverrides[selectedCourse] || course.pars;
  const pars = basePars.slice(0, holes);

  // Background photo — a hand-picked local image (src/assets/course-
  // backgrounds/) always wins when one's been added for this course, no
  // network call at all; otherwise falls back to the live Wikimedia
  // Commons search (re-fetched, or pulled from cache, whenever the
  // selected course changes). Guarded with a "still the current course"
  // check so a slow response for a course you've since switched away from
  // can't land late and overwrite what's now showing.
  const [bgImage, setBgImage] = useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const local = findCourseBackground(course.name);
    if (local) { setBgImage(local); return; }
    setBgImage(null);
    fetchCourseBackground(course.name).then(url => { if (!cancelled) setBgImage(url); });
    return () => { cancelled = true; };
  }, [course.name]);

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
          : React.createElement("span", { style: { color: "#888", fontSize: 13 } }, pars[i])
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
      React.createElement("td", { style: { ...styles.td, fontSize: 11, color: "#888" } }, "$" + r.pot)
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

    // Header
    React.createElement("div", { style: styles.header },
      React.createElement("div", null,
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } },
          React.createElement("div", { style: { ...styles.title, marginBottom: 0 } }, "⛳ Golf Scorecard"),
          React.createElement("span", { style: { fontSize: 10, color: "#aaa", background: "#f5f5f3", padding: "2px 6px", borderRadius: 6, fontWeight: 500 } }, "v" + GOLF_VERSION)
        ),
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
          React.createElement("button", { style: styles.courseBtn, onClick: () => setShowCourseModal(true) },
            course.name + " ▾"
          ),
          React.createElement("button", { style: styles.courseBtn, onClick: () => setShowBetSettings(true) },
            "⚙️ $" + betPerHole + "/hole"
          )
        )
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        React.createElement("button", { style: { ...styles.btn, color: "#185FA5" }, onClick: () => setShowSavedRounds(true) }, "📋 Saved (" + savedRounds.length + ")"),
        React.createElement("button", { style: { ...styles.btn, color: "#185FA5" }, onClick: () => shareScorecard(currentSnapshot()) }, "📱 Text"),
        React.createElement("button", { style: { ...styles.btn, color: "#27500A" }, onClick: saveRound }, "💾 Save Round"),
        React.createElement("button", { style: styles.btn, onClick: () => setEditingPars(!editingPars) }, editingPars ? "Done" : "Edit Pars"),
        React.createElement("button", { style: { ...styles.btn, color: "#A32D2D" }, onClick: resetScores }, "Reset"),
        // Full page reload — separate from Reset (which only clears
        // scores/greenies). Everything this page needs survives a reload
        // (localStorage), so this is just a plain, unconditional refresh,
        // useful for recovering from a stuck UI state or picking up a
        // just-deployed update.
        React.createElement("button", { style: styles.btn, title: "Restart the app", onClick: () => window.location.reload() }, "🔄 Restart")
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
  // sits behind everything; contentCard below is the opaque surface the
  // actual UI renders on, so a busy photo never fights with hole-row text.
  page: { fontFamily: "system-ui, sans-serif", minHeight: "100vh", backgroundColor: "#f5f5f3", backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" },
  contentCard: { maxWidth: 680, margin: "0 auto", padding: "1rem", paddingBottom: "3rem", background: "rgba(255,255,255,0.94)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: 8 },
  title: { fontSize: 20, fontWeight: 500, color: "#1a1a1a", marginBottom: 4 },
  courseBtn: { fontSize: 13, padding: "5px 10px", borderRadius: 8, border: "0.5px solid #185FA5", background: "#f0f4ff", color: "#185FA5", cursor: "pointer", fontWeight: 500 },
  btn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", cursor: "pointer", color: "#1a1a1a" },
  playerGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1rem" },
  playerCard: { background: "#f5f5f3", borderRadius: 12, padding: "12px 16px" },
  nameInput: { background: "none", border: "none", borderBottom: "0.5px solid #ccc", fontSize: 14, fontWeight: 500, color: "#1a1a1a", width: "100%", outline: "none", marginBottom: 6, padding: "2px 0" },
  carryBanner: { background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: "1rem" },
  tableWrap: { marginBottom: "1.5rem" },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { background: "#185FA5", color: "white", padding: "7px 6px", textAlign: "center", fontSize: 12, fontWeight: 500 },
  tr: { borderBottom: "0.5px solid #e0e0e0" },
  td: { padding: "5px 4px", textAlign: "center", fontSize: 13 },
  holeNum: { fontSize: 12, color: "#888", fontWeight: 500 },
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
