import React, { useState, useEffect, useRef } from "react";

export default function JobDetailModal({ job, accessToken, checkedIn, checkedOut, completed, onClose, onNotesSaved, logSheetId }) {
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  // Load existing notes and photos when modal opens
  useEffect(() => {
    loadNotesAndPhotos();
  }, []);

  const loadNotesAndPhotos = async () => {
    setLoading(true);
    try {
      // Load notes from Sheets
      if (logSheetId) {
        const res = await fetch(
          "https://sheets.googleapis.com/v4/spreadsheets/" + logSheetId + "/values/'Job Status'!A:D",
          { headers: { Authorization: "Bearer " + accessToken } }
        );
        const data = await res.json();
        const rows = data.values || [];
        // Find the most recent notes row for this job
        const notesRows = rows.filter(r => r[1] === job.id + "__notes" || r[1] === job.id.replace(/_\d{8}T\d{6}Z$/, "").replace(/_[a-z0-9]{26}$/, "") + "__notes");
        if (notesRows.length > 0) {
          const lastRow = notesRows[notesRows.length - 1];
          const fullText = lastRow[3] || "";
          // Split notes from photo links
          const photoSplit = fullText.split(" | Photos: ");
          setNotes(photoSplit[0]);
          // Load photo thumbnails if links exist
          if (photoSplit[1]) {
            const urls = photoSplit[1].split(", ").filter(Boolean);
            const photoObjs = urls.map(url => {
              const idMatch = url.match(/\/d\/([^/]+)/);
              const id = idMatch ? idMatch[1] : null;
              return { url, thumb: id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w200" : null, name: "Photo" };
            });
            setPhotos(photoObjs);
          }
        }
      }
    } catch (e) {
      console.warn("Could not load notes:", e);
    }
    setLoading(false);
  };

  // Get or create TechPortal Photos folder in Drive
  const getOrCreatePhotoFolder = async () => {
    const searchRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=name='TechPortal Photos'+and+mimeType='application/vnd.google-apps.folder'&fields=files(id)",
      { headers: { Authorization: "Bearer " + accessToken } }
    );
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) return searchData.files[0].id;
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ name: "TechPortal Photos", mimeType: "application/vnd.google-apps.folder" }),
    });
    const folder = await createRes.json();
    return folder.id;
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      const folderId = await getOrCreatePhotoFolder();
      const uploaded = [];
      for (const file of files) {
        const metadata = {
          name: job.title + " - " + new Date().toLocaleDateString() + " - " + file.name,
          parents: [folderId],
        };
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", file);
        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
          method: "POST",
          headers: { Authorization: "Bearer " + accessToken },
          body: form,
        });
        const data = await res.json();
        if (data.id) {
          await fetch("https://www.googleapis.com/drive/v3/files/" + data.id + "/permissions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
            body: JSON.stringify({ role: "reader", type: "anyone" }),
          });
          uploaded.push({ id: data.id, name: file.name, url: data.webViewLink, thumb: "https://drive.google.com/thumbnail?id=" + data.id + "&sz=w200" });
        }
      }
      setPhotos(prev => [...prev, ...uploaded]);
    } catch (e) {
      setError("Upload failed: " + e.message);
    }
    setUploading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      if (onNotesSaved) await onNotesSaved(job.id, notes, photos);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError("Save failed: " + e.message);
    }
    setSaving(false);
  };

  return React.createElement("div", {
    style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 3000 },
    onClick: onClose,
  },
    React.createElement("div", {
      style: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" },
      onClick: e => e.stopPropagation(),
    },
      // Header
      React.createElement("div", { style: { padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
        React.createElement("div", { style: { flex: 1 } },
          React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#1a1a1a" } }, job.title),
          React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, job.startTime + (job.endTime ? " – " + job.endTime : "")),
          job.location && React.createElement("div", { style: { fontSize: 12, color: "#666", marginTop: 2 } }, "📍 " + job.location.split(",").slice(0, 2).join(",")),
          React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" } },
            checkedIn && React.createElement("span", { style: { fontSize: 11, background: "#EAF3DE", color: "#27500A", padding: "2px 8px", borderRadius: 10 } }, "🟢 In: " + checkedIn),
            checkedOut && React.createElement("span", { style: { fontSize: 11, background: "#F0F4FF", color: "#185FA5", padding: "2px 8px", borderRadius: 10 } }, "🔴 Out: " + checkedOut),
            completed && React.createElement("span", { style: { fontSize: 11, background: "#EAF3DE", color: "#27500A", padding: "2px 8px", borderRadius: 10 } }, "✅ Done"),
          )
        ),
        React.createElement("button", { onClick: onClose, style: { fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#888", lineHeight: 1, paddingLeft: 12 } }, "×")
      ),

      // Scrollable body
      React.createElement("div", { style: { overflowY: "auto", flex: 1, padding: "1rem 1.25rem" } },
        loading
          ? React.createElement("div", { style: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 } }, "Loading notes...")
          : React.createElement(React.Fragment, null,

            // Notes
            React.createElement("div", { style: { marginBottom: 16 } },
              React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 } }, "📝 Notes"),
              React.createElement("textarea", {
                value: notes,
                onChange: e => setNotes(e.target.value),
                placeholder: "Add notes — customer info, equipment issues, tap counts, follow-ups...",
                style: { width: "100%", minHeight: 120, padding: "10px 12px", fontSize: 14, border: "1px solid #ddd", borderRadius: 10, resize: "vertical", fontFamily: "system-ui, sans-serif", boxSizing: "border-box", color: "#1a1a1a" },
              })
            ),

            // Photos
            React.createElement("div", { style: { marginBottom: 16 } },
              React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 } }, "📷 Photos" + (photos.length > 0 ? " (" + photos.length + ")" : "")),
              photos.length > 0 && React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 } },
                photos.map((p, i) => React.createElement("a", { key: i, href: p.url, target: "_blank", rel: "noreferrer", style: { display: "block", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "#f5f5f3", position: "relative" } },
                  p.thumb
                    ? React.createElement("img", { src: p.thumb, alt: p.name, style: { width: "100%", height: "100%", objectFit: "cover" } })
                    : React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 24 } }, "📷")
                ))
              ),
              React.createElement("input", { ref: fileInputRef, type: "file", accept: "image/*", multiple: true, capture: "environment", style: { display: "none" }, onChange: handlePhotoUpload }),
              React.createElement("div", { style: { display: "flex", gap: 8 } },
                React.createElement("button", {
                  onClick: () => { if (fileInputRef.current) { fileInputRef.current.removeAttribute("capture"); fileInputRef.current.click(); } },
                  disabled: uploading,
                  style: { flex: 1, padding: "10px", borderRadius: 10, border: "2px dashed #ccc", background: "#fafafa", color: "#666", cursor: "pointer", fontSize: 13, fontWeight: 500 },
                }, uploading ? "⏳ Uploading..." : "📁 Choose Photo"),
                React.createElement("button", {
                  onClick: () => { if (fileInputRef.current) { fileInputRef.current.setAttribute("capture", "environment"); fileInputRef.current.click(); } },
                  disabled: uploading,
                  style: { flex: 1, padding: "10px", borderRadius: 10, border: "2px dashed #ccc", background: "#fafafa", color: "#666", cursor: "pointer", fontSize: 13, fontWeight: 500 },
                }, "📷 Take Photo")
              )
            ),

            error && React.createElement("div", { style: { fontSize: 13, color: "#c0392b", background: "#fef0f0", padding: "8px 12px", borderRadius: 8, marginBottom: 12 } }, error),
          )
      ),

      // Footer
      React.createElement("div", { style: { padding: "0.75rem 1.25rem", borderTop: "0.5px solid #e0e0e0" } },
        React.createElement("button", {
          onClick: handleSave,
          disabled: saving || loading,
          style: { width: "100%", padding: "12px", borderRadius: 10, background: saved ? "#27500A" : "#185FA5", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 15, transition: "background 0.3s" },
        }, saved ? "✅ Saved!" : saving ? "Saving..." : "Save Notes & Photos")
      )
    )
  );
}
