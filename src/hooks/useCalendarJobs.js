import { useState, useEffect } from "react";

export function useCalendarJobs(accessToken, selectedDate) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    fetchEvents(accessToken, selectedDate);
  }, [accessToken, selectedDate]);

  const fetchEvents = async (token, date) => {
    setLoading(true);
    setError(null);
    try {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

      // Two separate param sets — one for timed events, one for all-day
      const baseParams = {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: "true",
        maxResults: "50",
        fields: "items(id,summary,description,location,start,end,htmlLink,attachments,organizer)",
      };

      const calendarIds = [
        "primary",
        "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com",
      ];

      const results = await Promise.all(
        calendarIds.map((calendarId) =>
          fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${new URLSearchParams(baseParams)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ).then(async (res) => {
            if (!res.ok) {
              console.warn("[TechPortal] Calendar fetch failed for", calendarId, res.status);
              return { items: [], calendarId };
            }
            const data = await res.json();
            console.log("[TechPortal] Calendar", calendarId, "returned", data.items?.length, "events");
            return { ...data, calendarId };
          })
        )
      );

      const allEvents = results.flatMap((data) =>
        (data.items || []).map((event) => ({ ...event, _calendarId: data.calendarId }))
      );

      // Filter out personal/non-work events from primary calendar
      // Keep everything from Beer Line Cleaning calendar
      const BEER_LINE_CAL = "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com";
      const filtered = allEvents.filter(event => {
        if (event._calendarId === BEER_LINE_CAL) return true;
        // From primary — only include if it looks like a work event (has a location)
        return !!event.location;
      });

      const unique = Array.from(
        new Map(filtered.map((e) => [e.id, e])).values()
      );

      const sorted = unique.sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || "";
        const bTime = b.start?.dateTime || b.start?.date || "";
        return aTime.localeCompare(bTime);
      });

      console.log("[TechPortal] Total jobs after filter:", sorted.length);
      setJobs(sorted.map(parseEvent));
    } catch (err) {
      console.error("[TechPortal] Calendar fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { jobs, loading, error, refresh: () => fetchEvents(accessToken, selectedDate) };
}

function parseEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;

  const attachments = event.attachments || [];
  const imageAttachment = attachments.find(a => a.mimeType && a.mimeType.startsWith("image/"));
  const attachmentUrl = imageAttachment
    ? "https://drive.google.com/uc?export=view&id=" + imageAttachment.fileId
    : null;

  return {
    id: event.id,
    calendarId: event._calendarId,
    title: event.summary || "Untitled job",
    description: event.description || "",
    location: event.location || "",
    startTime: start ? formatTime(start) : "All day",
    endTime: end ? formatTime(end) : "",
    startRaw: start,
    status: deriveStatus(start, end),
    calendarLink: event.htmlLink,
    attachmentUrl,
  };
}

function formatTime(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return isoString;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function deriveStatus(start, end) {
  const now = new Date();
  const s = new Date(start);
  const e = new Date(end);
  if (now < s) return "Scheduled";
  if (now >= s && now <= e) return "In Progress";
  return "Done";
}
