import { useState, useEffect, useCallback } from "react";

// Same job calendars/filtering rules as useCalendarJobs.js (single source of
// truth for "what counts as a job" — see CLAUDE.md's Data model section):
// keep everything from the Beer Line Cleaning calendar, and from the
// primary calendar only keep events that have a location (personal events
// like "Vacation" don't, so they're excluded here too, same as day view).
const BEER_LINE_CAL = "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com";

export function useMonthCalendarJobs(accessToken, monthDate) {
  const [eventsByDay, setEventsByDay] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const fetchMonth = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const startOfMonth = new Date(year, month, 1);
      const endOfMonth = new Date(year, month + 1, 1);

      const baseParams = {
        timeMin: startOfMonth.toISOString(),
        timeMax: endOfMonth.toISOString(),
        singleEvents: "true",
        maxResults: "2500",
        fields: "items(id,summary,description,location,start,end,htmlLink)",
      };

      const calendarIds = ["primary", BEER_LINE_CAL];

      const results = await Promise.all(
        calendarIds.map((calendarId) =>
          fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${new URLSearchParams(baseParams)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ).then(async (res) => {
            if (!res.ok) {
              console.warn("[TechPortal] Month calendar fetch failed for", calendarId, res.status);
              return { items: [], calendarId };
            }
            const data = await res.json();
            return { ...data, calendarId };
          })
        )
      );

      const allEvents = results.flatMap((data) =>
        (data.items || []).map((event) => ({ ...event, _calendarId: data.calendarId }))
      );

      const filtered = allEvents.filter((event) => {
        if (event._calendarId === BEER_LINE_CAL) return true;
        return !!event.location;
      });

      const unique = Array.from(new Map(filtered.map((e) => [e.id, e])).values());

      const grouped = {};
      unique.forEach((event) => {
        const parsed = parseEvent(event);
        const key = dayKeyFor(event, parsed);
        if (!key) return;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(parsed);
      });
      Object.keys(grouped).forEach((k) => {
        grouped[k].sort((a, b) => (a.startRaw || "").localeCompare(b.startRaw || ""));
      });

      setEventsByDay(grouped);
    } catch (err) {
      console.error("[TechPortal] Month calendar fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, year, month]);

  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  // setEventsByDay is exposed directly so the drag-and-drop reschedule in
  // CalendarMonthView can optimistically move a job between days without
  // waiting on a full refetch — it's reconciled with the server's actual
  // state on the next natural refresh (month change, pull-to-refresh, etc).
  return { eventsByDay, setEventsByDay, loading, error, refresh: fetchMonth };
}

// All-day events already come back from Google as a plain YYYY-MM-DD date
// (no timezone conversion needed/wanted); timed events are keyed off their
// local calendar day so they land in the same cell a person would expect.
function dayKeyFor(event, parsed) {
  if (event.start?.date) return event.start.date;
  if (!parsed.startRaw) return null;
  const d = new Date(parsed.startRaw);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const isAllDay = !!event.start?.date && !event.start?.dateTime;
  const rawTitle = event.summary || "Untitled job";
  const isMissed = /^⚠️ MISSED - /.test(rawTitle);

  return {
    id: event.id,
    calendarId: event._calendarId,
    title: rawTitle.replace(/^⚠️ MISSED - /, ""),
    isMissed,
    isAllDay,
    location: event.location || "",
    startTime: !isAllDay && start ? formatTime(start) : "",
    startRaw: start,
    calendarLink: event.htmlLink,
  };
}

function formatTime(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
