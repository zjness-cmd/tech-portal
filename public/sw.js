// TechPortal Service Worker v4 — with background geofence
const CACHE_NAME = "techportal-v4";
const SHELL_FILES = ["/", "/index.html", "/manifest.json"];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== "techportal-maps").map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.hostname.includes("googleapis.com") || url.hostname.includes("google.com")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match("/index.html"));
    })
  );
});

// ── Background geofence via periodic sync ────────────────────────────────────
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "geofence-check") {
    event.waitUntil(doGeofenceCheck());
  }
});

// ── Message from app: store geofence data ────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "STORE_GEOFENCE_DATA") {
    // Store job coords, token, checked-in state in SW cache for background use
    storeGeofenceData(event.data.payload);
  }
  if (event.data?.type === "START_BACKGROUND_GEOFENCE") {
    startBackgroundInterval();
  }
  if (event.data?.type === "STOP_BACKGROUND_GEOFENCE") {
    stopBackgroundInterval();
  }
});

// Store in SW's own IndexedDB-like cache via caches API
async function storeGeofenceData(data) {
  try {
    const cache = await caches.open("techportal-geofence");
    const response = new Response(JSON.stringify(data));
    await cache.put("/geofence-data", response);
  } catch (e) {}
}

async function getGeofenceData() {
  try {
    const cache = await caches.open("techportal-geofence");
    const response = await cache.match("/geofence-data");
    if (response) return await response.json();
  } catch (e) {}
  return null;
}

// ── Background interval (runs in SW even when app is closed) ─────────────────
let bgInterval = null;

function startBackgroundInterval() {
  if (bgInterval) return;
  bgInterval = setInterval(doGeofenceCheck, 30 * 1000); // every 30s
}

function stopBackgroundInterval() {
  if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
}

async function doGeofenceCheck() {
  const data = await getGeofenceData();
  if (!data || !data.dayStarted || data.dayFinished) return;
  if (!data.jobCoords || !data.accessToken) return;

  // Get current position
  let pos = null;
  try {
    // SW can't use navigator.geolocation directly, so we message the client
    const clients = await self.clients.matchAll({ type: "window" });
    if (clients.length > 0) {
      // App is open — let it handle geofencing via watchPosition
      return;
    }
    // App is closed — we can't get GPS from SW directly
    // Instead, show a notification to prompt user to open app if a job is upcoming
    await checkUpcomingJobs(data);
  } catch (e) {}
}

async function checkUpcomingJobs(data) {
  const now = new Date();
  const jobs = data.jobs || [];
  const checkedIn = data.checkedIn || {};
  const completed = data.completed || {};

  // Find jobs starting within the next 15 minutes that aren't checked in
  const upcoming = jobs.filter(j => {
    if (checkedIn[j.id] || completed[j.id]) return false;
    if (!j.startTime) return false;
    try {
      const [time, ampm] = j.startTime.split(" ");
      let [h, m] = time.split(":").map(Number);
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      const jobStart = new Date();
      jobStart.setHours(h, m, 0, 0);
      const diff = (jobStart - now) / 60000;
      return diff >= 0 && diff <= 15;
    } catch { return false; }
  });

  if (upcoming.length > 0) {
    const job = upcoming[0];
    await self.registration.showNotification("📍 Job starting soon", {
      body: job.title + " starts in " + Math.round(((new Date().setHours(...job.startTime.split(/[: ]/).map((v,i) => i===0?parseInt(v):v))) - Date.now()) / 60000) + " min — tap to check in",
      icon: "/favicon-96x96.png",
      badge: "/favicon-96x96.png",
      tag: "job-reminder-" + job.id,
      data: { jobId: job.id },
      actions: [{ action: "checkin", title: "Check In" }],
    });
  }
}

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: "NOTIFICATION_CHECKIN", jobId: event.notification.data?.jobId });
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});