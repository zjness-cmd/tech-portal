// Shared helper for moving a Google Calendar event to a different day while
// preserving its time-of-day (for timed events) or just its date span (for
// all-day events). Used by the month view's drag-and-drop reschedule.
//
// This is a separate, additive helper rather than a reuse of Dashboard.jsx's
// shiftCalendarEventTime (the check-in cascade-reschedule function) — that
// one shifts by a flat millisecond delta, which is fine for the small
// same-day drifts it's built for, but wrong here: a multi-day drag can
// cross a DST boundary, and a flat-ms shift would silently drift the
// wall-clock time by an hour. This does local calendar-date arithmetic
// instead, so "move to next Tuesday" always lands at the same time of day.
//
// Deliberately does NOT touch Dashboard.jsx's existing reschedule logic —
// CLAUDE.md flags that code as sensitive/field-tested, so this stays
// independent rather than risking it.

function shiftDateTimeByDays(isoString, deltaDays) {
  const d = new Date(isoString);
  const shifted = new Date(
    d.getFullYear(), d.getMonth(), d.getDate() + deltaDays,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
  );
  return shifted.toISOString();
}

function shiftDateOnlyByDays(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Moves an event forward/back by a whole number of days. Always refetches
 * the live event first (never trusts local state) so the patch is based on
 * the calendar's current truth, then retries a couple times with backoff
 * on a network blip before giving up — same resilience pattern as
 * Dashboard.jsx's shiftCalendarEventTime.
 *
 * Returns the updated event, or throws after exhausting retries.
 */
export async function shiftCalendarEventByDays(accessToken, calendarId, eventId, deltaDays, retryCount = 0) {
  if (!accessToken || !calendarId || !eventId || !deltaDays) return null;
  const base = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events/" + eventId;
  try {
    const res = await fetch(base, { headers: { Authorization: "Bearer " + accessToken } });
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    const event = await res.json();

    const patch = {};
    if (event.start?.dateTime && event.end?.dateTime) {
      patch.start = { dateTime: shiftDateTimeByDays(event.start.dateTime, deltaDays), timeZone: event.start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
      patch.end = { dateTime: shiftDateTimeByDays(event.end.dateTime, deltaDays), timeZone: event.end.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
    } else if (event.start?.date && event.end?.date) {
      patch.start = { date: shiftDateOnlyByDays(event.start.date, deltaDays) };
      patch.end = { date: shiftDateOnlyByDays(event.end.date, deltaDays) };
    } else {
      return event; // nothing recognizable to shift — leave it alone
    }

    const patchRes = await fetch(base, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify(patch),
    });
    if (!patchRes.ok) throw new Error("Patch failed: " + patchRes.status);
    return await patchRes.json();
  } catch (e) {
    if (retryCount < 2) {
      await new Promise((r) => setTimeout(r, (retryCount + 1) * 1500));
      return shiftCalendarEventByDays(accessToken, calendarId, eventId, deltaDays, retryCount + 1);
    }
    throw e;
  }
}
