// Shared helper for sending Web Push notifications (underscore-prefixed so
// Vercel doesn't deploy this as its own route — api/push-subscribe.js and
// api/quote-lead.js both `require` it).
//
// Subscriptions are stored in the same Firebase RTDB project as /quoteLeads,
// under /pushSubscriptions/<key>, keyed by a sanitized hash of each
// subscription's endpoint URL so re-subscribing the same device overwrites
// its old entry instead of piling up duplicates.
//
// Entirely optional, like FIREBASE_DB_SECRET/ANTHROPIC_API_KEY before it: if
// VAPID keys or Firebase aren't configured, sendPushToAllSubscribers() is a
// silent no-op — a new lead still gets emailed either way, this is purely an
// enhancement on top of that.
const webpush = require("web-push");

// Reuses the client's VITE_VAPID_PUBLIC_KEY var server-side (same pattern as
// VITE_FIREBASE_DB_URL elsewhere in this file) instead of asking for the same
// public key to be set twice under two different names.
function vapidConfigured() {
  return !!(process.env.VITE_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureVapid() {
  webpush.setVapidDetails("mailto:zjness@gmail.com", process.env.VITE_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

// Firebase RTDB keys can't contain ".", "#", "$", "[", "]", or "/" — this
// collapses an endpoint URL down to something safe to use as one.
function keyFor(endpoint) {
  return String(endpoint).replace(/[^a-zA-Z0-9]/g, "_").slice(-200);
}

async function sendPushToAllSubscribers(payload) {
  const dbUrl = process.env.VITE_FIREBASE_DB_URL;
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!vapidConfigured() || !dbUrl || !secret) return;

  let subs;
  try {
    const r = await fetch(dbUrl + "/pushSubscriptions.json?auth=" + secret);
    subs = await r.json();
  } catch {
    return;
  }
  if (!subs) return;

  configureVapid();
  const body = JSON.stringify(payload);
  await Promise.all(
    Object.entries(subs).map(async ([key, subscription]) => {
      try {
        await webpush.sendNotification(subscription, body);
      } catch (e) {
        // 404/410 = the browser revoked this subscription (uninstalled,
        // cleared site data, etc.) — clean it up so we stop sending to it.
        if (e.statusCode === 404 || e.statusCode === 410) {
          fetch(dbUrl + "/pushSubscriptions/" + key + ".json?auth=" + secret, { method: "DELETE" }).catch(() => {});
        } else {
          console.error("[push] send failed:", e.statusCode, e.message);
        }
      }
    })
  );
}

module.exports = { sendPushToAllSubscribers, keyFor };
