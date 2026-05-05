import React, { useState, useEffect } from "react";

const TEMPLATE_ID = "1mk7ZUarysG0TTAYHlmJAfCjNXAXTWTzq-b6vtewW95c";
const BUSINESS = { name: "Ness Draft Beer Service", address1: "PO Box 222", address2: "Albertville, MN 55301", phone: "612-293-9459" };

export default function InvoiceModal({ job, accessToken, onClose }) {
  const [step, setStep] = useState("type");
  const [invoiceType, setInvoiceType] = useState(null);
  const [taps, setTaps] = useState("");
  const [pricePerTap, setPricePerTap] = useState("");
  const [clientName, setClientName] = useState(job.title || "");
  const [searchQuery, setSearchQuery] = useState(job.title || "");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const [sheetUrl, setSheetUrl] = useState(null);
  const [error, setError] = useState(null);
  const [squareToken, setSquareToken] = useState("");
  const [squareLocation, setSquareLocation] = useState("");

  const total = taps && pricePerTap ? (parseFloat(taps) * parseFloat(pricePerTap)).toFixed(2) : null;
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long" });
  const invoiceNumber = (now.getMonth() + 1).toString().padStart(2, "0") + now.getDate().toString().padStart(2, "0") + now.getFullYear();
  const dateStr = (now.getMonth() + 1).toString().padStart(2, "0") + "/" + now.getDate().toString().padStart(2, "0") + "/" + now.getFullYear().toString().slice(-2);
  const description = monthName + " Beer line cleaning";
  const quantityStr = taps + " taps @ $" + pricePerTap + "/tap";

  useEffect(() => {
    fetch("/api/invoice").then((r) => r.json()).then((d) => {
      setSquareToken(d.squareToken || "");
      setSquareLocation(d.squareLocation || "");
    }).catch(() => {});
  }, []);

  const searchSquareCustomers = async (query) => {
    if (!query || query.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch("https://connect.squareup.com/v2/customers?limit=100", {
        headers: { "Authorization": "Bearer " + squareToken }
      });
      const data = await res.json();
      const filtered = (data.customers || []).filter((c) => {
        const name = ((c.given_name || "") + " " + (c.family_name || "") + " " + (c.company_name || "")).toLowerCase();
        return name.includes(query.toLowerCase());
      });
      setSearchResults(filtered.slice(0, 5));
    } catch (e) { setError("Could not search Square customers."); }
    setSearching(false);
  };

  const sendSquareInvoice = async () => {
    if (!selectedCustomer || !total) return;
    setSending(true);
    setError(null);
    try {
      const orderRes = await fetch("https://connect.squareup.com/v2/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + squareToken },
        body: JSON.stringify({
          order: {
            location_id: squareLocation,
            customer_id: selectedCustomer.id,
            line_items: [{ name: description, quantity: "1", base_price_money: { amount: Math.round(parseFloat(total) * 100), currency: "USD" } }]
          },
          idempotency_key: Date.now().toString()
        })
      });
      const orderData = await orderRes.json();
      if (!orderData.order) throw new Error("Failed to create order");
      const invoiceRes = await fetch("https://connect.squareup.com/v2/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + squareToken },
        body: JSON.stringify({
          invoice: {
            location_id: squareLocation,
            order_id: orderData.order.id,
            primary_recipient: { customer_id: selectedCustomer.id },
            payment_requests: [{ request_type: "BALANCE", due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] }],
            delivery_method: "EMAIL",
            invoice_number: "INV-" + invoiceNumber,
            title: "Beer Line Cleaning",
            description: description + " - " + job.title
          },
          idempotency_key: "inv-" + Date.now().toString()
        })
      });
      const invoiceData = await invoiceRes.json();
      if (!invoiceData.invoice) throw new Error("Failed to create invoice");
      await fetch("https://connect.squareup.com/v2/invoices/" + invoiceData.invoice.id + "/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + squareToken },
        body: JSON.stringify({ version: invoiceData.invoice.version, idempotency_key: "pub-" + Date.now().toString() })
      });
      setDone("Square invoice sent to " + (selectedCustomer.email_address || selectedCustomer.company_name || "customer") + "!");
    } catch (e) { setError(e.message || "Failed to send invoice."); }
    setSending(false);
  };

  const createSheetsInvoice = async () => {
    if (!total || !clientName) return;
    setSending(true);
    setError(null);
    try {
      const invoiceTitle = monthName + " " + now.getFullYear() + " " + clientName + " Beer Line Cleaning Invoice";

      // Copy the template
      const copyRes = await fetch("https://www.googleapis.com/drive/v3/files/" + TEMPLATE_ID + "/copy?supportsAllDrives=true", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ name: invoiceTitle })
      });
      const copyData = await copyRes.json();
      if (!copyData.id) throw new Error("Could not copy template. Make sure the template is shared.");
      const newSheetId = copyData.id;

      // Fill in the values
      const values = [
        { range: "A1", values: [[`=IMAGE("https://drive.google.com/uc?export=view&id=1fRo4xZH0Xcl-DK-hVgKWVLLkMOvX2ihZ")`]] },
        { range: "F4", values: [[dateStr]] },
        { range: "F5", values: [[invoiceNumber]] },
        { range: "F6", values: [[clientName]] },
        { range: "B16", values: [[quantityStr]] },
        { range: "C16", values: [[description]] },
        { range: "E16", values: [["$" + total]] },
        { range: "E20", values: [["=SUM(E16:E19)"]] },
      ];

      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + newSheetId + "/values:batchUpdate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: values })
      });

      setSheetUrl("https://docs.google.com/spreadsheets/d/" + newSheetId + "/edit");
      setDone("Invoice created!");
    } catch (e) { setError(e.message || "Failed to create invoice."); }
    setSending(false);
  };

  return (
    React.createElement("div", { style: styles.overlay, onClick: onClose },
      React.createElement("div", { style: styles.modal, onClick: (e) => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Create Invoice"),
          React.createElement("button", { style: styles.closeBtn, onClick: onClose }, "\u00D7")
        ),
        React.createElement("div", { style: styles.jobInfo },
          React.createElement("div", { style: styles.jobName }, job.title),
          job.location && React.createElement("div", { style: styles.jobLoc }, "\uD83D\uDCCD " + job.location),
          React.createElement("div", { style: styles.jobDate }, now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))
        ),
        done ? (
          React.createElement("div", { style: styles.successBox },
            React.createElement("div", { style: styles.successIcon }, "\u2705"),
            React.createElement("div", { style: styles.successText }, done),
            sheetUrl && React.createElement("a", { href: sheetUrl, target: "_blank", rel: "noreferrer", style: styles.openSheetBtn }, "\uD83D\uDCC4 Open Invoice in Sheets"),
            React.createElement("button", { style: styles.doneBtn, onClick: onClose }, "Done")
          )
        ) : step === "type" ? (
          React.createElement("div", null,
            React.createElement("div", { style: styles.sectionLabel }, "How do you want to invoice this client?"),
            React.createElement("div", { style: styles.typeRow },
              React.createElement("button", { style: styles.typeBtn, onClick: () => { setInvoiceType("square"); setStep("details"); } },
                React.createElement("div", { style: styles.typeBtnIcon }, "\uD83D\uDFE6"),
                React.createElement("div", { style: styles.typeBtnLabel }, "Square"),
                React.createElement("div", { style: styles.typeBtnSub }, "Email invoice, pay online")
              ),
              React.createElement("button", { style: styles.typeBtn, onClick: () => { setInvoiceType("sheets"); setStep("details"); } },
                React.createElement("div", { style: styles.typeBtnIcon }, "\uD83D\uDCCA"),
                React.createElement("div", { style: styles.typeBtnLabel }, "Google Sheets"),
                React.createElement("div", { style: styles.typeBtnSub }, "Creates formatted invoice")
              )
            )
          )
        ) : (
          React.createElement("div", null,
            React.createElement("div", { style: styles.fieldGroup },
              React.createElement("label", { style: styles.fieldLabel }, "Client name"),
              React.createElement("input", { style: styles.input, type: "text", placeholder: "e.g. Tavern 13", value: clientName, onChange: (e) => setClientName(e.target.value) })
            ),
            React.createElement("div", { style: styles.fieldGroup },
              React.createElement("label", { style: styles.fieldLabel }, "Number of taps"),
              React.createElement("input", { style: styles.input, type: "number", min: "1", placeholder: "e.g. 10", value: taps, onChange: (e) => setTaps(e.target.value) })
            ),
            React.createElement("div", { style: styles.fieldGroup },
              React.createElement("label", { style: styles.fieldLabel }, "Price per tap ($)"),
              React.createElement("input", { style: styles.input, type: "number", min: "1", placeholder: "e.g. 15", value: pricePerTap, onChange: (e) => setPricePerTap(e.target.value) })
            ),
            total && React.createElement("div", { style: styles.totalBox },
              React.createElement("span", { style: styles.totalLabel }, "Total"),
              React.createElement("span", { style: styles.totalVal }, "$" + total)
            ),
            invoiceType === "square" && (
              React.createElement("div", { style: styles.fieldGroup },
                React.createElement("label", { style: styles.fieldLabel }, "Search Square customer"),
                React.createElement("div", { style: { display: "flex", gap: 8 } },
                  React.createElement("input", { style: { ...styles.input, flex: 1 }, type: "text", placeholder: "Type client name...", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value) }),
                  React.createElement("button", { style: styles.searchBtn, onClick: () => searchSquareCustomers(searchQuery) }, searching ? "..." : "Search")
                ),
                searchResults.length > 0 && React.createElement("div", { style: styles.searchResults },
                  searchResults.map((c) => {
                    const name = [c.given_name, c.family_name].filter(Boolean).join(" ") || c.company_name || "Unknown";
                    return React.createElement("div", { key: c.id, style: { ...styles.searchResult, ...(selectedCustomer && selectedCustomer.id === c.id ? styles.searchResultSelected : {}) }, onClick: () => setSelectedCustomer(c) },
                      React.createElement("div", { style: styles.searchResultName }, name),
                      c.email_address && React.createElement("div", { style: styles.searchResultEmail }, c.email_address)
                    );
                  })
                ),
                selectedCustomer && React.createElement("div", { style: styles.selectedCustomer }, "\u2713 " + ([selectedCustomer.given_name, selectedCustomer.family_name].filter(Boolean).join(" ") || selectedCustomer.company_name))
              )
            ),
            error && React.createElement("div", { style: styles.errorBox }, error),
            React.createElement("div", { style: styles.actionRow },
              React.createElement("button", { style: styles.backBtn, onClick: () => setStep("type") }, "\u2190 Back"),
              invoiceType === "square"
                ? React.createElement("button", { style: { ...styles.sendBtn, opacity: (!total || !selectedCustomer || sending) ? 0.5 : 1 }, disabled: !total || !selectedCustomer || sending, onClick: sendSquareInvoice }, sending ? "Sending..." : "Send Square Invoice")
                : React.createElement("button", { style: { ...styles.sendBtn, opacity: (!total || !clientName || sending) ? 0.5 : 1 }, disabled: !total || !clientName || sending, onClick: createSheetsInvoice }, sending ? "Creating..." : "Create Invoice")
            )
          )
        )
      )
    )
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  modalTitle: { fontSize: 16, fontWeight: 600, color: "#1a1a1a" },
  closeBtn: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888", lineHeight: 1 },
  jobInfo: { padding: "1rem 1.25rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0" },
  jobName: { fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 },
  jobLoc: { fontSize: 13, color: "#666", marginBottom: 2 },
  jobDate: { fontSize: 12, color: "#888" },
  sectionLabel: { fontSize: 13, color: "#888", padding: "1rem 1.25rem 0.5rem" },
  typeRow: { display: "flex", gap: 12, padding: "0 1.25rem 1.25rem" },
  typeBtn: { flex: 1, padding: "1rem", border: "0.5px solid #e0e0e0", borderRadius: 12, background: "#fff", cursor: "pointer", textAlign: "center" },
  typeBtnIcon: { fontSize: 24, marginBottom: 6 },
  typeBtnLabel: { fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 },
  typeBtnSub: { fontSize: 11, color: "#888" },
  fieldGroup: { padding: "0 1.25rem 0.75rem" },
  fieldLabel: { fontSize: 12, color: "#888", display: "block", marginBottom: 4 },
  input: { width: "100%", padding: "10px 12px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 8, background: "#fff", color: "#1a1a1a", boxSizing: "border-box" },
  totalBox: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 1.25rem 0.75rem", padding: "0.75rem 1rem", background: "#EAF3DE", borderRadius: 8 },
  totalLabel: { fontSize: 13, color: "#27500A", fontWeight: 500 },
  totalVal: { fontSize: 22, fontWeight: 700, color: "#27500A" },
  searchBtn: { padding: "10px 16px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" },
  searchResults: { marginTop: 6, border: "0.5px solid #e0e0e0", borderRadius: 8, overflow: "hidden" },
  searchResult: { padding: "10px 12px", cursor: "pointer", borderBottom: "0.5px solid #f0f0f0" },
  searchResultSelected: { background: "#E6F1FB" },
  searchResultName: { fontSize: 14, fontWeight: 500, color: "#1a1a1a" },
  searchResultEmail: { fontSize: 12, color: "#888" },
  selectedCustomer: { marginTop: 6, fontSize: 13, color: "#27500A", fontWeight: 500 },
  errorBox: { margin: "0 1.25rem 0.75rem", padding: "0.75rem", background: "#FCEBEB", borderRadius: 8, fontSize: 13, color: "#A32D2D" },
  actionRow: { display: "flex", gap: 8, padding: "0.75rem 1.25rem 1.25rem" },
  backBtn: { padding: "10px 16px", background: "#f5f5f3", color: "#555", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  sendBtn: { flex: 1, padding: "10px 16px", background: "#185FA5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  successBox: { padding: "2rem 1.25rem", textAlign: "center" },
  successIcon: { fontSize: 40, marginBottom: 12 },
  successText: { fontSize: 14, color: "#27500A", marginBottom: 16, lineHeight: 1.5 },
  openSheetBtn: { display: "block", margin: "0 auto 12px", padding: "10px 20px", background: "#185FA5", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 500 },
  doneBtn: { padding: "10px 24px", background: "#f5f5f3", color: "#555", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 },
};
