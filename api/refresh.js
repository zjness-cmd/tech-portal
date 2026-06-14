export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const cookies = req.headers.cookie || "";
  const refreshToken = cookies.split(";").map(c => c.trim()).find(c => c.startsWith("tp_refresh="))?.split("=").slice(1).join("=");
  if (!refreshToken) return res.status(401).json({ error: "No refresh token" });
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    const data = await tokenRes.json();
    if (data.error) return res.status(401).json({ error: data.error });
    res.json({ access_token: data.access_token, expires_in: data.expires_in || 3600 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
