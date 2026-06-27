export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ETSY_API_KEY = process.env.ETSY_API_KEY;
  const ETSY_SHARED_SECRET = process.env.ETSY_SHARED_SECRET;
  const ETSY_SHOP_NAME = "NessTapHandles";

  if (!ETSY_API_KEY) return res.status(500).json({ error: "Etsy API key not configured" });

  const { endpoint } = req.query;
  const BASE = "https://openapi.etsy.com/v3/application";
  const headers = { "x-api-key": ETSY_API_KEY + (ETSY_SHARED_SECRET ? ":" + ETSY_SHARED_SECRET : "") };

  try {
    // Look up numeric shop ID from shop name
    const shopLookup = await fetch(BASE + "/shops?shop_name=" + ETSY_SHOP_NAME, { headers });
    const shopLookupData = await shopLookup.json();
    const shopId = shopLookupData.results?.[0]?.shop_id;
    if (!shopId) return res.status(404).json({ error: "Shop not found: " + ETSY_SHOP_NAME, details: shopLookupData });

    let url = "";
    switch (endpoint) {
      case "shop":
        url = BASE + "/shops/" + shopId;
        break;
      case "listings":
        url = BASE + "/shops/" + shopId + "/listings/active?limit=25&includes=Images,MainImage";
        break;
      case "receipts":
        url = BASE + "/shops/" + shopId + "/receipts?limit=25&was_paid=true";
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