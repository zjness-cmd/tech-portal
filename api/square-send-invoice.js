// Vercel serverless function — creates and publishes a Square invoice
// server-to-server (order -> invoice -> publish), so the browser never
// calls connect.squareup.com or holds a Square token directly. See
// api/square-customers.js for why: Square's Connect REST API blocks
// direct browser/CORS calls, so InvoiceModal.jsx's old client-side
// approach could never actually succeed regardless of credentials.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    res.status(200).json({ error: "SQUARE_ACCESS_TOKEN and/or SQUARE_LOCATION_ID not set in Vercel env vars." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { customerId, description, amount, title, jobTitle, invoiceNumber } = body || {};
  if (!customerId || !amount) {
    res.status(200).json({ error: "Missing customerId or amount." });
    return;
  }

  try {
    const orderRes = await fetch("https://connect.squareup.com/v2/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        order: {
          location_id: locationId,
          customer_id: customerId,
          line_items: [{ name: description, quantity: "1", base_price_money: { amount: Math.round(amount * 100), currency: "USD" } }],
        },
        idempotency_key: "ord-" + Date.now(),
      }),
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.order) {
      res.status(200).json({ error: (orderData.errors && orderData.errors[0] && orderData.errors[0].detail) || "Failed to create order." });
      return;
    }

    const invRes = await fetch("https://connect.squareup.com/v2/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        invoice: {
          location_id: locationId,
          order_id: orderData.order.id,
          primary_recipient: { customer_id: customerId },
          payment_requests: [{ request_type: "BALANCE", due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] }],
          delivery_method: "EMAIL",
          invoice_number: invoiceNumber || ("INV-" + Date.now()),
          title: title || "Beer Line Cleaning",
          description: description + (jobTitle ? " - " + jobTitle : ""),
        },
        idempotency_key: "inv-" + Date.now(),
      }),
    });
    const invData = await invRes.json();
    if (!invRes.ok || !invData.invoice) {
      res.status(200).json({ error: (invData.errors && invData.errors[0] && invData.errors[0].detail) || "Failed to create invoice." });
      return;
    }

    const pubRes = await fetch("https://connect.squareup.com/v2/invoices/" + invData.invoice.id + "/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ version: invData.invoice.version, idempotency_key: "pub-" + Date.now() }),
    });
    const pubData = await pubRes.json();
    if (!pubRes.ok) {
      res.status(200).json({ error: (pubData.errors && pubData.errors[0] && pubData.errors[0].detail) || "Failed to publish invoice." });
      return;
    }

    res.status(200).json({
      invoiceNumber: invData.invoice.invoice_number,
      publicUrl: (pubData.invoice && pubData.invoice.public_url) || invData.invoice.public_url || null,
    });
  } catch (e) {
    res.status(200).json({ error: e.message });
  }
};
