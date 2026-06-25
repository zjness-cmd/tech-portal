export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ETSY_API_KEY = process.env.ETSY_API_KEY;
  const ETSY_SHOP_ID = process.env.ETSY_SHOP_ID;

  if (!ETSY_API_KEY || !ETSY_SHOP_ID) {
    return res.status(500).json({ error: "Etsy API key or Shop ID not configured" });
  }

  const { endpoint } = req.query;
  const BASE = "https://openapi.etsy.com/v3/application";
  const headers = { "x-api-key": ETSY_API_KEY };

  try {
    let url = "";
    switch (endpoint) {
      case "shop":
        url = BASE + "/shops/" + ETSY_SHOP_ID;
        break;
      case "listings":
        url = BASE + "/shops/" + ETSY_SHOP_ID + "/listings/active?limit=25&includes=Images,MainImage";
        break;
      case "receipts":
        url = BASE + "/shops/" + ETSY_SHOP_ID + "/receipts?limit=25&was_paid=true";
        break;
      case "stats":
        url = BASE + "/shops/" + ETSY_SHOP_ID + "/listings/active?limit=100";
        break;
      default:
        return res.status(400).json({ error: "Unknown endpoint: " + endpoint });
    }

    const r = await fetch(url, { headers });
    const data = await r.json();

    if (!r.ok) return res.status(r.status).json({ error: data.error || "Etsy API error", details: data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}