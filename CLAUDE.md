# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TechPortal is a single-user (two allowed accounts) mobile-first PWA that a field service tech uses to run their workday: pull today's jobs from Google Calendar, check in/out via GPS geofencing, log mileage, track revenue and unpaid invoices, and send Square invoices. It doubles as a personal dashboard (Etsy shop stats, a golf scorecard page) for the same user. There is no traditional backend database — **Google Sheets is the database**, and Google Calendar is the job source of truth.

## Commands

```
npm run dev       # start Vite dev server
npm run build      # production build (node node_modules/vite/bin/vite.js build)
npm run preview    # preview the production build
```

There is no test suite, linter, or type checker configured in this repo — don't invent commands for them.

Deployment is via Vercel (`vercel.json` present, `.vercel/` linked). `api/*.js` files are deployed as Vercel serverless functions; there's no separate backend server/process.

## Environment variables

Split between client-exposed (Vite, must be prefixed `VITE_`) and server-only (Vercel functions, `process.env`, never bundled to the client):

- Client: `VITE_MAPS_API_KEY` (Google Maps JS API + Street View + Distance Matrix — used in `Dashboard.jsx` and `JobCard.jsx`)
- Server (`api/*.js`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth token exchange/refresh), `GOOGLE_GEOCODE_KEY` (geocoding proxy), `ETSY_API_KEY`, `ETSY_SHARED_SECRET` (Etsy shop stats), `SQUARE_TOKEN`, `SQUARE_LOCATION` (invoicing)

The Google OAuth client ID for the frontend login button is hardcoded in `src/main.jsx`, not read from env.

`.env` / `.env.local` in this repo currently only declare a handful of these locally — most are configured directly in the Vercel project, so don't assume a var is unused just because it's absent from the local `.env` files.

## Architecture

### Auth flow (Google OAuth, no database for sessions)

- `App.jsx` uses `@react-oauth/google`'s `flow: "auth-code"` to get an authorization code, then trades it for tokens via `api/auth.js`, which exchanges the code with Google and sets the refresh token as an **httpOnly cookie** (`tp_refresh`). The access token is returned to the client and kept in React state + `localStorage` (`google_token`, `google_token_expiry`).
- Access is gated by a hardcoded allowlist (`ALLOWED_EMAILS` in `App.jsx`) checked against the Google profile email after login — there is no broader user system.
- `api/refresh.js` reads the `tp_refresh` cookie and silently mints a new access token; `App.jsx` calls this on a 50-minute timer (tokens last 60 min), on `visibilitychange`/`online` events (to recover from a backgrounded/suspended tab), and with retry/backoff — see the extensive comments around `silentRefresh` in `App.jsx` before touching this logic, it encodes several field-observed race conditions (concurrent refreshes, false-positive network errors vs. real 401s).
- The OAuth scopes requested include Calendar, Sheets, and Drive — the same access token is reused directly from the client to call the Google Calendar/Sheets/Drive REST APIs (no separate backend proxy for those, unlike Etsy/geocode/Square which do proxy through `api/`).

### Data model: Google Sheets as the database

There is no SQL/NoSQL database. `Dashboard.jsx` lazily finds-or-creates a spreadsheet named by `LOG_SHEET_NAME` (`"TechPortal Job Log 2026"`) via the Drive API, then manages several tabs within it directly via the Sheets API:
- `Job Log` — append-only log of completed jobs (date, job, check-in time, distance, invoice sent, notes)
- `Job Status` (`STATUS_SHEET_NAME`) — per-day per-job status rows (checked in/out, completed, payment status), the source of truth reloaded on every date change (`loadJobStatuses`)
- `Accounts Receivable` (`AR_SHEET_NAME`) — unpaid-invoice tracking that persists across days (loaded once per session, not per selected date)

Sheet/tab bootstrap functions (`getOrCreateLogSheet`, `ensureStatusTab`, `ensureARTab`) are idempotent — always check for the tab before creating it and writing headers.

**Jobs themselves come from Google Calendar**, not Sheets — `useCalendarJobs.js` pulls events from two calendars (`primary` and a "Beer Line Cleaning" calendar ID) for the selected day, merges/dedupes them, and filters out non-job events. `Dashboard.jsx` further filters out personal entries via a manually maintained title-pattern blacklist (`NON_JOB_TITLE_PATTERNS`) since personal and work events share the same calendar with no other distinguishing field — extend this list rather than trying to find a structural way to separate them.

### Offline-first local state and write reconciliation

Because this is used in the field with unreliable connectivity, `Dashboard.jsx` layers a lot of resilience on top of the Sheets round-trips:
- Status writes go through a pending-save queue (`pendingStatusRef`, mirrored to `localStorage` under `techportal_pendingSaves` via `persistPending`) so an in-flight write survives a killed/reloaded tab and gets retried (`flushStatusSaves`).
- `recentlyConfirmedRef` guards against a subtler bug: a write that Sheets has *acknowledged* can still be invisible to a read moments later (eventual consistency), which would otherwise look like the write silently reverted. Recently-confirmed writes are trusted over a conflicting read for a grace window (`RECENT_CONFIRM_GRACE_MS`).
- `checkInLockRef` / `cascadedTodayRef` guard against duplicate check-ins from double-taps or the geofence watcher re-firing.
- Most per-day state (mileage log, GPS track, job values, debug log, job status cache) is stored in `localStorage` under keys namespaced by the day (e.g. `mileageLog_<dateString>`). A pruning pass removes old daily keys to avoid hitting storage quota after months of use — keep that in mind if you add another daily-keyed cache.

### Geofencing (check-in/out automation)

Runs both in the foreground (`Dashboard.jsx`, using `navigator.geolocation`) and in the background via the service worker (`public/sw.js`), which caches geofence data (job coordinates, checked-in/completed state) so auto check-in/out can keep working when the tab isn't focused. `syncGeofenceDataToSW` pushes the latest state to the SW whenever it changes. GPS accuracy handling is deliberately tiered (see `GEOFENCE_HARD_ACCURACY_CUTOFF_M` comments in `Dashboard.jsx`): readings worse than the hard cutoff are discarded outright, but degraded-but-usable readings (common indoors) are compensated for rather than thrown away.

### Calendar rescheduling ("cascade")

When a job's actual check-in time drifts meaningfully from its scheduled time, `cascadeReschedule`/`shiftCalendarEventTime`/`maybeUpdateRecurringSeries` in `Dashboard.jsx` can shift that event (and optionally the rest of the day's recurring series) on the calendar itself, gated by `CASCADE_THRESHOLD_MS` so small drift is ignored. This mutates the user's actual Google Calendar — be careful with changes here.

### Component structure

- `App.jsx` — auth/session shell, PWA install prompt, routes to `GolfScorecard` for `/golf` or `Dashboard` otherwise
- `Dashboard.jsx` — the app; large by design (state, Sheets I/O, geofencing, invoicing, AR, rescheduling all live here rather than being split into hooks/services)
- `useCalendarJobs.js` — the one piece of data-fetching pulled into a hook
- `JobCard.jsx` / `JobDetailModal.jsx` — per-job UI, Street View preview
- `InvoiceModal.jsx` — Square invoice creation (via `api/invoice.js` handing back client credentials for the client-side Square SDK)
- `RescheduleModal.jsx`, `DriveMode.jsx` (turn-by-turn-style nav view), `EtsyStats.jsx` (separate Etsy shop dashboard panel), `GolfScorecard.jsx` (standalone page, unrelated feature sharing this app's auth/deploy)
- `api/*.js` — thin Vercel serverless proxies; keep secrets server-side here rather than moving calls to the client

### PWA / service worker

`public/sw.js` does app-shell caching plus the background geofence support described above. Bump `CACHE_NAME`'s version suffix (currently `techportal-v5`) when changing cached asset behavior, matching the existing pattern.

## Notes

- `APP_VERSION` in `Dashboard.jsx` is a manually maintained version string shown in the UI/debug export — bump it when making user-visible changes, following existing commit message conventions (`vX.Y.Z` in the message).
- Comments in `Dashboard.jsx` and `App.jsx` frequently document *why* a piece of defensive logic exists (specific field-observed bugs/races) — read them before "simplifying" that code, the edge cases are usually the point.
