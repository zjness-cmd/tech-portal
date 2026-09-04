import React, { useState, useEffect } from "react";
import { INVOICE_BUSINESS, INVOICE_SQUARE_PAY_URL } from "./Dashboard";

const TEMPLATE_ID = "1mk7ZUarysG0TTAYHlmJAfCjNXAXTWTzq-b6vtewW95c";

export default function InvoiceModal({ job, accessToken, onClose, onInvoiceCreated, onPaymentStatusSaved }) {
  const checkInTime = job.checkInTime || null;
  const checkOutTime = job.checkOutTime || null;
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
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(null);
  const [sheetUrl, setSheetUrl] = useState(null);
  const [newSheetId, setNewSheetId] = useState(null);
  const [error, setError] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusSaved, setStatusSaved] = useState(false);
  // In-app email prompt rather than window.prompt() — see the payAmountPrompt
  // comment in Dashboard.jsx: prompt() silently no-ops on some installed/
  // standalone PWA Android builds instead of showing a dialog.
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");

  const total = taps && pricePerTap ? (parseFloat(taps) * parseFloat(pricePerTap)).toFixed(2) : null;
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long" });
  const invoiceNumber = (now.getMonth() + 1).toString().padStart(2, "0") + now.getDate().toString().padStart(2, "0") + now.getFullYear();
  const dateStr = (now.getMonth() + 1).toString().padStart(2, "0") + "/" + now.getDate().toString().padStart(2, "0") + "/" + now.getFullYear().toString().slice(-2);
  const description = monthName + " Beer line cleaning";
  const quantityStr = taps + " taps @ $" + pricePerTap + "/tap";

  // Both Square calls below go through api/square-customers.js and
  // api/square-send-invoice.js rather than connect.squareup.com directly.
  // Square's Connect REST API doesn't send CORS headers for browser
  // origins, so a direct client-side fetch (the old design here, via
  // api/invoice.js handing back a raw token) is always blocked by the
  // browser regardless of how correct the token is — that's why searches
  // always failed with "Could not search Square customers." Proxying
  // server-to-server through Vercel's own serverless functions has no
  // CORS issue, and as a bonus the Square token itself never has to reach
  // the browser anymore.
  const searchSquareCustomers = async (query) => {
    if (!query || query.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/square-customers?q=" + encodeURIComponent(query));
      const data = await res.json();
      if (data.error) { setError(data.error); setSearchResults([]); }
      else setSearchResults((data.customers || []).slice(0, 5));
    } catch (e) { setError("Could not search Square customers."); }
    setSearching(false);
  };

  const sendSquareInvoice = async () => {
    if (!selectedCustomer || !total) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/square-send-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          description,
          amount: parseFloat(total),
          title: "Beer Line Cleaning",
          jobTitle: job.title,
          invoiceNumber: "INV-" + invoiceNumber,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Notify Dashboard so the View Invoice button lights up
      const invoiceUrl = data.publicUrl || "https://squareup.com/dashboard/invoices";
      if (onInvoiceCreated) onInvoiceCreated(job.id, invoiceUrl);

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

      const copyRes = await fetch("https://www.googleapis.com/drive/v3/files/" + TEMPLATE_ID + "/copy?supportsAllDrives=true", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ name: invoiceTitle })
      });
      const copyData = await copyRes.json();
      if (!copyData.id) throw new Error("Could not copy template. Make sure the template is shared.");
      const createdSheetId = copyData.id;

      // Formatting requests below (mergeCells/repeatCell/etc) need the
      // numeric sheetId of the tab, not the spreadsheet file id — fetch it
      // rather than assuming 0, in case the template's first tab ever
      // changes.
      const metaRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + createdSheetId + "?fields=sheets.properties", {
        headers: { Authorization: "Bearer " + accessToken }
      });
      const metaData = await metaRes.json();
      const sheetId = metaData.sheets?.[0]?.properties?.sheetId ?? 0;

      const serviceTimeStr = checkInTime && checkOutTime
        ? "Service time: " + checkInTime + " – " + checkOutTime
        : checkInTime
          ? "Check-in: " + checkInTime
          : "";

      const values = [
        { range: "F4", values: [[dateStr]] },
        { range: "F5", values: [[invoiceNumber]] },
        { range: "F6", values: [[clientName]] },
        { range: "B16", values: [[quantityStr]] },
        { range: "C16", values: [[description]] },
        { range: "E16", values: [["$" + total]] },
        { range: "E20", values: [["=SUM(E16:E19)"]] },
        ...(serviceTimeStr ? [{ range: "B17", values: [[serviceTimeStr]] }] : []),
        { range: "B19", values: [["(enter invoice #" + invoiceNumber + " when prompted so it's matched to this invoice)"]] },
      ];

      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + createdSheetId + "/values:batchUpdate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: values })
      });

      // Renders B18 as a wide blue "button" bar (merged B18:D18, taller
      // row) with a real embedded hyperlink rather than an =HYPERLINK()
      // formula — a formula's link doesn't survive the .../export?format=pdf
      // endpoint used in downloadAsPdf, but a cell-level textFormat.link
      // does. Also wraps the row-19 invoice-number note so it doesn't get
      // cut off.
      await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + createdSheetId + ":batchUpdate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({
          requests: [
            {
              mergeCells: {
                range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 1, endColumnIndex: 4 },
                mergeType: "MERGE_ALL"
              }
            },
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 1, endColumnIndex: 4 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.09, green: 0.37, blue: 0.65 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                    textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 1, green: 1, blue: 1 } }
                  }
                },
                fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)"
              }
            },
            // Runs after repeatCell above so its link-bearing textFormat
            // wins for B18 — repeatCell's fields spec replaces textFormat
            // wholesale, so if this ran first repeatCell would strip the
            // link right back out.
            {
              updateCells: {
                range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 1, endColumnIndex: 2 },
                rows: [{
                  values: [{
                    userEnteredValue: { stringValue: "💳  PAY BILL ONLINE" },
                    userEnteredFormat: {
                      textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 1, green: 1, blue: 1 }, link: { uri: INVOICE_SQUARE_PAY_URL } }
                    }
                  }]
                }],
                fields: "userEnteredValue,userEnteredFormat.textFormat"
              }
            },
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: 17, endIndex: 18 },
                properties: { pixelSize: 32 },
                fields: "pixelSize"
              }
            },
            {
              mergeCells: {
                range: { sheetId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 1, endColumnIndex: 4 },
                mergeType: "MERGE_ALL"
              }
            },
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 1, endColumnIndex: 4 },
                cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
                fields: "userEnteredFormat.wrapStrategy"
              }
            }
          ]
        })
      });

      const createdUrl = "https://docs.google.com/spreadsheets/d/" + createdSheetId + "/edit";
      setNewSheetId(createdSheetId);
      setSheetUrl(createdUrl);
      setDone("Invoice created!");

      // Notify Dashboard so the View Invoice button lights up
      if (onInvoiceCreated) onInvoiceCreated(job.id, createdUrl);
    } catch (e) { setError(e.message || "Failed to create invoice."); }
    setSending(false);
  };

  // Payment status is no longer written directly by this component — it's
  // handed off to Dashboard via onPaymentStatusSaved. Dashboard owns the
  // single "Accounts Receivable" tab (ID, Name, Amount, Date Added, Paid)
  // used by the Unpaid Accounts page; this component writing its own rows
  // there previously used a different column layout (Date, Client, Amount,
  // Invoice #, Status) that silently corrupted reads from that page — e.g.
  // "$150.00" isn't parseable the same way "150" is, and an invoice marked
  // Paid here would still show up as unpaid there. One writer, one schema.
  const savePaymentStatus = (status) => {
    setPaymentStatus(status);
    setSavingStatus(true);
    try {
      if (onPaymentStatusSaved) {
        onPaymentStatusSaved(status, {
          clientName,
          amount: total ? parseFloat(total) : null,
          invoiceNumber,
        });
      }
      setStatusSaved(true);
    } catch (e) {
      setError("Could not save payment status: " + e.message);
    }
    setSavingStatus(false);
  };

  // Builds a pre-filled mailto: link, same structure as handleSendInvoice
  // in Dashboard.jsx, but pointed at this Sheets invoice's own sheetUrl
  // instead of an Unpaid Accounts entry.
  const handleEmailInvoice = () => {
    const email = emailInput.trim();
    if (!email || !email.includes("@")) { setError("Enter a valid email address."); return; }

    const amountStr = "$" + total;
    const subject = "Invoice from " + INVOICE_BUSINESS.name;
    const body = [
      "Hi " + clientName + ",",
      "",
      "Here's your invoice for beer line cleaning service.",
      "",
      "Invoice: " + sheetUrl,
      "Amount due: " + amountStr,
      "",
      "Pay online by card:",
      INVOICE_SQUARE_PAY_URL,
      "(enter invoice #" + invoiceNumber + " when prompted so it's matched to this invoice)",
      "",
      "Or mail a check to:",
      INVOICE_BUSINESS.name,
      INVOICE_BUSINESS.addr1,
      INVOICE_BUSINESS.addr2,
      "(please write invoice #" + invoiceNumber + " on the memo line)",
      "",
      "Thanks for your business!",
      INVOICE_BUSINESS.name,
      INVOICE_BUSINESS.phone,
    ].join("\n");

    const mailto = "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    window.location.href = mailto;
    setEmailPromptOpen(false);
    setEmailInput("");
  };

  const downloadAsPdf = async () => {
    if (!newSheetId) return;
    setDownloading(true);
    try {
      await new Promise((r) => setTimeout(r, 3000));
      const pdfUrl = "https://docs.google.com/spreadsheets/d/" + newSheetId + "/export?format=pdf&size=letter&portrait=true&fitw=true&sheetnames=false&printtitle=false&pagenumbers=false&gridlines=false&fzr=false";
      const res = await fetch(pdfUrl, { headers: { Authorization: "Bearer " + accessToken } });
      if (!res.ok) throw new Error("Could not export PDF");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = monthName + " " + now.getFullYear() + " " + clientName + " Invoice.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError("PDF download failed. Try opening the sheet and downloading manually.");
    }
    setDownloading(false);
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
          React.createElement("div", { style: styles.jobDate }, now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })),
          (checkInTime || checkOutTime) && React.createElement("div", { style: styles.jobTimes },
            checkInTime && React.createElement("span", null, "🟢 In: " + checkInTime),
            checkInTime && checkOutTime && React.createElement("span", null, " · "),
            checkOutTime && React.createElement("span", null, "🔴 Out: " + checkOutTime)
          )
        ),

        done ? (
          React.createElement("div", { style: styles.successBox },
            React.createElement("div", { style: styles.successIcon }, "\u2705"),
            React.createElement("div", { style: styles.successText }, done),

            !statusSaved ? (
              React.createElement("div", { style: styles.paymentSection },
                React.createElement("div", { style: styles.paymentLabel }, "Payment status"),
                React.createElement("div", { style: styles.paymentRow },
                  React.createElement("button", {
                    style: { ...styles.paymentBtn, ...(paymentStatus === "paid" ? styles.paymentBtnPaid : {}) },
                    onClick: () => !savingStatus && savePaymentStatus("paid"),
                    disabled: savingStatus
                  }, "✅ Paid"),
                  React.createElement("button", {
                    style: { ...styles.paymentBtn, ...(paymentStatus === "pending" ? styles.paymentBtnPending : {}) },
                    onClick: () => !savingStatus && savePaymentStatus("pending"),
                    disabled: savingStatus
                  }, "⏳ Awaiting Payment")
                ),
                savingStatus && React.createElement("div", { style: styles.savingText }, "Saving...")
              )
            ) : (
              React.createElement("div", { style: {
                ...styles.statusSavedBadge,
                background: paymentStatus === "paid" ? "#EAF3DE" : "#FAEEDA",
                color: paymentStatus === "paid" ? "#27500A" : "#633806"
              }}, paymentStatus === "paid" ? "✅ Marked as Paid" : "⏳ Marked as Awaiting Payment — added to Unpaid Accounts")
            ),

            sheetUrl && React.createElement("a", { href: sheetUrl, target: "_blank", rel: "noreferrer", style: styles.openSheetBtn }, "\uD83D\uDCC4 Open Invoice in Sheets"),
            newSheetId && React.createElement("button", {
              style: { ...styles.openSheetBtn, background: "#27500A", border: "none", cursor: "pointer", display: "block", margin: "0 auto 12px", textAlign: "center" },
              onClick: downloadAsPdf,
              disabled: downloading
            }, downloading ? "⏳ Generating PDF..." : "⬇️ Download as PDF"),
            sheetUrl && !emailPromptOpen && React.createElement("button", {
              style: { ...styles.openSheetBtn, background: "#fff", color: "#185FA5", border: "1px solid #185FA5", cursor: "pointer", display: "block", margin: "0 auto 12px", textAlign: "center" },
              onClick: () => { setEmailInput(selectedCustomer?.email_address || ""); setEmailPromptOpen(true); },
            }, "✉️ Email Invoice"),
            sheetUrl && emailPromptOpen && React.createElement("div", { style: styles.paymentSection },
              React.createElement("div", { style: styles.paymentLabel }, "Client's email"),
              React.createElement("input", {
                style: styles.input, type: "email", inputMode: "email", autoFocus: true, placeholder: "customer@example.com",
                value: emailInput, onChange: (e) => setEmailInput(e.target.value),
                onKeyDown: (e) => { if (e.key === "Enter") handleEmailInvoice(); },
              }),
              React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } },
                React.createElement("button", { style: { ...styles.backBtn }, onClick: () => { setEmailPromptOpen(false); setEmailInput(""); } }, "Cancel"),
                React.createElement("button", { style: styles.sendBtn, onClick: handleEmailInvoice }, "✉️ Open Email to Send")
              )
            ),
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
  // Invoice is opened from the ✉️ Invoice button inside JobDetailModal,
  // which stays mounted underneath (zIndex 3000) rather than closing
  // itself first — so this has to sit above that or it renders hidden
  // behind it, which is what was happening at zIndex 1000.
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3500, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  modalTitle: { fontSize: 16, fontWeight: 600, color: "#1a1a1a" },
  closeBtn: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888", lineHeight: 1 },
  jobInfo: { padding: "1rem 1.25rem", background: "#f5f5f3", borderBottom: "0.5px solid #e0e0e0" },
  jobName: { fontSize: 15, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 },
  jobLoc: { fontSize: 13, color: "#666", marginBottom: 2 },
  jobDate: { fontSize: 12, color: "#888" },
  jobTimes: { fontSize: 12, color: "#185FA5", marginTop: 4, fontWeight: 500 },
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
  paymentSection: { margin: "0 0 16px", padding: "1rem", background: "#f5f5f3", borderRadius: 12 },
  paymentLabel: { fontSize: 12, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 },
  paymentRow: { display: "flex", gap: 8 },
  paymentBtn: { flex: 1, padding: "10px 12px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", color: "#555", cursor: "pointer", fontSize: 13, fontWeight: 500 },
  paymentBtnPaid: { background: "#EAF3DE", color: "#27500A", borderColor: "#27500A" },
  paymentBtnPending: { background: "#FAEEDA", color: "#633806", borderColor: "#633806" },
  savingText: { fontSize: 12, color: "#888", marginTop: 8 },
  statusSavedBadge: { margin: "0 0 12px", padding: "0.75rem 1rem", borderRadius: 8, fontSize: 14, fontWeight: 500 },
  openSheetBtn: { display: "block", margin: "0 auto 12px", padding: "10px 20px", background: "#185FA5", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 500 },
  doneBtn: { padding: "10px 24px", background: "#f5f5f3", color: "#555", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 },
};
