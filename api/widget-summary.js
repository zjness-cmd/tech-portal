// Lightweight, read-only summary endpoint for a home-screen widget (e.g.
// KWGT on Android) — polled directly from the phone, outside any browser
// session, so it can't rely on the tp_refresh httpOnly cookie like the rest
// of the app does. Instead it uses a dedicated long-lived refresh token
// (WIDGET_REFRESH_TOKEN) captured once from a logged-in browser session, and
// a shared secret (WIDGET_SECRET) passed as ?token= to keep this endpoint
// from being a public read of the calendar.
//
// Same "primary + Beer Line Cleaning calendar, filter to things that look
// like jobs" logic as useCalendarJobs.js, trimmed to what a glanceable
// widget needs — job count and the next upcoming job.

const BEER_LINE_CAL = "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com";
const NON_JOB_TITLE_PATTERNS = [/^B Shift \d+$/i, /^Vacation$/i, /^Hot tub maintenance/i];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.WIDGET_SECRET || req.query.token !== process.env.WIDGET_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.WIDGET_REFRESH_TOKEN) {
    return res.status(500).json({ error: "Widget not configured — missing WIDGET_REFRESH_TOKEN" });
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: process.env.WIDGET_REFRESH_TOKEN,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return res.status(401).json({ error: "Token refresh failed: " + tokenData.error });
    }
    const accessToken = tokenData.access_token;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const baseParams = {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: "true",
      maxResults: "50",
      fields: "items(id,summary,location,start,end)",
    };
    const calendarIds = ["primary", BEER_LINE_CAL];

    const results = await Promise.all(
      calendarIds.map((calendarId) =>
        fetch(
          "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) + "/events?" + new URLSearchParams(baseParams),
          { headers: { Authorization: "Bearer " + accessToken } }
        ).then(async (r) => (r.ok ? { items: (await r.json()).items || [], calendarId } : { items: [], calendarId }))
      )
    );

    const allEvents = results.flatMap((data) => data.items.map((e) => ({ ...e, _calendarId: data.calendarId })));

    const jobs = allEvents.filter((event) => {
      const title = event.summary || "";
      if (NON_JOB_TITLE_PATTERNS.some((p) => p.test(title))) return false;
      if (event._calendarId === BEER_LINE_CAL) return true;
      return !!event.location; // primary calendar: only things with a location look like jobs
    });

    const unique = Array.from(new Map(jobs.map((e) => [e.id, e])).values())
      .sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || "";
        const bTime = b.start?.dateTime || b.start?.date || "";
        return aTime.localeCompare(bTime);
      });

    const upcoming = unique.find((e) => {
      const end = new Date(e.end?.dateTime || e.end?.date);
      return !isNaN(end) && end > now;
    });

    res.json({
      date: now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      jobCount: unique.length,
      nextJob: upcoming
        ? {
            title: (upcoming.summary || "Untitled").replace(/^(⚠️ MISSED - )+/, ""),
            time: upcoming.start?.dateTime
              ? new Date(upcoming.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : "All day",
            location: upcoming.location || "",
          }
        : null,
      updatedAt: now.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
