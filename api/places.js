// Server-side proxy for auto-discovering a client's website from their
// business name + address, via Google's Places API (Find Place From Text,
// then Place Details for the website field — Find Place doesn't return
// website itself). Used to populate job-card logos without the user having
// to type in a URL for every client by hand.
//
// Requires the Places API enabled on the same Google Cloud project as
// GOOGLE_GEOCODE_KEY (and that key not restricted away from it).

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "Missing query" });

  const key = process.env.GOOGLE_GEOCODE_KEY;
  try {
    const findParams = new URLSearchParams({ input: query, inputtype: "textquery", fields: "place_id", key });
    const findRes = await fetch("https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" + findParams);
    const findData = await findRes.json();

    if (findData.status === "ZERO_RESULTS") return res.json({ website: null });
    if (findData.status !== "OK") {
      return res.status(502).json({ error: findData.status, detail: findData.error_message });
    }
    const placeId = findData.candidates?.[0]?.place_id;
    if (!placeId) return res.json({ website: null });

    const detailParams = new URLSearchParams({ place_id: placeId, fields: "website", key });
    const detailRes = await fetch("https://maps.googleapis.com/maps/api/place/details/json?" + detailParams);
    const detailData = await detailRes.json();

    if (detailData.status !== "OK") {
      return res.status(502).json({ error: detailData.status, detail: detailData.error_message });
    }
    res.json({ website: detailData.result?.website || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
