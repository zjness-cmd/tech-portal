export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { address, latlng, result_type } = req.query;
  if (!address && !latlng) return res.status(400).json({ error: "Missing address or latlng" });

  try {
    const params = { key: process.env.VITE_MAPS_API_KEY };
    if (address) params.address = address;
    if (latlng) params.latlng = latlng;
    if (result_type) params.result_type = result_type;
    const url = "https://maps.googleapis.com/maps/api/geocode/json?" + new URLSearchParams(params);
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}