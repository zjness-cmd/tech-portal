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

      const params = new URLSearchParams({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "50",
      });

      const calendarIds = [
        "primary",
        "f2nn520vkuublps8kegfbg45ts@group.calendar.google.com",
      ];

      const results = await Promise.all(
        calendarIds.map((id) =>
          fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${params}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ).then((res) => {
            if (!res.ok) return { items: [] };
            return res.json();
          })
        )
      );

      const allEvents = results.flatMap((data) => data.items || []);
      const unique = Array.from(new Map(allEvents.map((e) => [e.id, e])).values());
      const sorted = unique.sort((a, b) => {
        const aTime = a.start?.dateTime || a.start?.date || "";
        const bTime = b.start?.dateTime || b.start?.date || "";
        return aTime.localeCompare(bTime);
      });
      setJobs(sorted.map(parseEvent));
    } catch (err) {
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
  return {
    id: event.id,
    title: event.summary || "Untitled job",
    description: event.description || "",
    location: event.location || "",
    startTime: start ? formatTime(start) : "All day",
    endTime: end ? formatTime(end) : "",
    startRaw: start,
    status: deriveStatus(start, end),
    calendarLink: event.htmlLink,
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