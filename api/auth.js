export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });

  // Debug: log env vars are present (not their values)
  console.log("[auth] GOOGLE_CLIENT_ID present:", !!process.env.GOOGLE_CLIENT_ID);
  console.log("[auth] GOOGLE_CLIENT_SECRET present:", !!process.env.GOOGLE_CLIENT_SECRET);
  console.log("[auth] code received (first 10 chars):", code?.slice(0, 10));

  try {
    const body = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    };

    console.log("[auth] Sending to Google with client_id:", process.env.GOOGLE_CLIENT_ID?.slice(0, 20) + "...");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await tokenRes.json();
    console.log("[auth] Google response status:", tokenRes.status);
    console.log("[auth] Google response:", JSON.stringify(data));

    if (data.error) {
      return res.status(400).json({ error: data.error, detail: data.error_description });
    }

    if (data.refresh_token) {
      res.setHeader("Set-Cookie",
        `tp_refresh=${data.refresh_token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`
      );
    }

    res.json({ access_token: data.access_token, expires_in: data.expires_in || 3600 });
  } catch (e) {
    console.error("[auth] Exception:", e.message);
    res.status(500).json({ error: e.message });
  }
}