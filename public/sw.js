// TechPortal Service Worker v5 — persistent background geofence
const CACHE_NAME = "techportal-v5";
const SHELL_FILES = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== "techportal-maps" && k !== "techportal-geofence").map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

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

// ── Store/get geofence data ───────────────────────────────────────────────────
async function storeGeofenceData(data) {
  try {
    const cache = await caches.open("techportal-geofence");
    await cache.put("/geofence-data", new Response(JSON.stringify(data)));
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

// ── Messages from app ─────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "STORE_GEOFENCE_DATA") {
    storeGeofenceData(event.data.payload);
  }
  if (event.data?.type === "START_BACKGROUND_GEOFENCE") {
    startBackgroundInterval();
    showTrackingNotification();
  }
  if (event.data?.type === "STOP_BACKGROUND_GEOFENCE") {
    stopBackgroundInterval();
    clearTrackingNotification();
  }
  if (event.data?.type === "DAY_FINISHED") {
    stopBackgroundInterval();
    clearTrackingNotification();
  }
});

// ── Persistent "tracking active" notification ─────────────────────────────────
async function showTrackingNotification() {
  const data = await getGeofenceData();
  if (!data?.dayStarted || data?.dayFinished) return;
  const jobs = (data.jobs || []).filter(j => !data.checkedIn?.[j.id] && !data.completed?.[j.id]);
  try {
    await self.registration.showNotification("📍 TechPortal — Day Active", {
      body: jobs.length > 0
        ? "Next: " + jobs[0].title + " · Tap to open app"
        : "Tracking your location · Tap to open app",
      icon: "/favicon-96x96.png",
      badge: "/favicon-96x96.png",
      tag: "tracking-active",
      renotify: false,
      silent: true,
      requireInteraction: false,
    });
  } catch (e) {}
}

async function clearTrackingNotification() {
  try {
    const notifications = await self.registration.getNotifications({ tag: "tracking-active" });
    notifications.forEach(n => n.close());
  } catch (e) {}
}

// ── Periodic background interval ──────────────────────────────────────────────
let bgInterval = null;

function startBackgroundInterval() {
  if (bgInterval) return;
  bgInterval = setInterval(async () => {
    const data = await getGeofenceData();
    if (!data?.dayStarted || data?.dayFinished) { stopBackgroundInterval(); return; }

    // Check if app is open — if so, let it handle geofencing
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients.length > 0) {
      // App is open — update tracking notification with latest job
      showTrackingNotification();
      return;
    }

    // App is closed — check for upcoming jobs and send reminder
    await checkUpcomingJobs(data);
    // Refresh tracking notification
    showTrackingNotification();
  }, 60 * 1000); // every 60s
}

function stopBackgroundInterval() {
  if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
}

// ── Periodic sync (when supported) ───────────────────────────────────────────
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "geofence-check") {
    event.waitUntil((async () => {
      const data = await getGeofenceData();
      if (!data?.dayStarted || data?.dayFinished) return;
      await checkUpcomingJobs(data);
      showTrackingNotification();
    })());
  }
});

// ── Check for jobs starting soon ──────────────────────────────────────────────
async function checkUpcomingJobs(data) {
  const now = new Date();
  const jobs = data.jobs || [];
  const checkedIn = data.checkedIn || {};
  const completed = data.completed || {};

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
      return diff >= -5 && diff <= 20; // within 5 min past or 20 min future
    } catch { return false; }
  });

  if (upcoming.length > 0) {
    const job = upcoming[0];
    try {
      await self.registration.showNotification("📍 Open TechPortal to check in", {
        body: job.title + " — tap to open app and check in",
        icon: "/favicon-96x96.png",
        badge: "/favicon-96x96.png",
        tag: "job-reminder-" + job.id,
        data: { jobId: job.id },
        requireInteraction: true,
        actions: [{ action: "open", title: "Open App" }],
      });
    } catch (e) {}
  }
}

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        if (event.notification.data?.jobId) {
          clients[0].postMessage({ type: "NOTIFICATION_CHECKIN", jobId: event.notification.data.jobId });
        }
      } else {
        self.clients.openWindow("/");
      }
    })
  );
});