import React, { useState } from "react";

function normalizeId(id) {
  if (!id) return id;
  return id.replace(/_\d{8}T\d{6}Z$/, "").replace(/_[a-z0-9]{26}$/, "");
}

const STATUS_COLORS = {
  "Done":        { bg: "#EAF3DE", color: "#27500A", label: "✅ Done" },
  "Checked Out": { bg: "#F0F4FF", color: "#185FA5", label: "🔴 Checked Out" },
  "Checked In":  { bg: "#FAEEDA", color: "#633806", label: "🟢 In Progress" },
  "Scheduled":   { bg: "#f5f5f3", color: "#666",    label: "Scheduled" },
};

export default function DriveMode({
  jobs, checkedIn, checkedOut, completed, location,
  onCheckIn, onCheckOut, onComplete, dayStarted, displayMiles, onExit,
}) {
  const [confirmJob, setConfirmJob] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const getStatus = (job) => {
    const id = normalizeId(job.id);
    if (completed[id]) return "Done";
    if (checkedOut[id]) return "Checked Out";
    if (checkedIn[id]) return "Checked In";
    return "Scheduled";
  };

  const sorted = [...jobs].sort((a, b) => {
    const order = { "Checked In": 0, "Scheduled": 1, "Checked Out": 2, "Done": 3 };
    return (order[getStatus(a)] ?? 9) - (order[getStatus(b)] ?? 9);
  });

  const handleTap = (job, action) => {
    setConfirmJob(job);
    setConfirmAction(action);
  };

  const handleConfirm = () => {
    const nid = normalizeId(confirmJob.id);
    if (confirmAction === "checkin") onCheckIn(nid, confirmJob.title);
    if (confirmAction === "checkout") onCheckOut(nid, confirmJob.title);
    if (confirmAction === "complete") onComplete(nid);
    setConfirmJob(null);
    setConfirmAction(null);
  };

  return React.createElement("div", { style: styles.page },

    // ── Confirm overlay ─────────────────────────────────────────────────
    confirmJob && React.createElement("div", { style: styles.confirmOverlay, onClick: () => { setConfirmJob(null); setConfirmAction(null); } },
      React.createElement("div", { style: styles.confirmBox, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.confirmTitle },
          confirmAction === "checkin" ? "📍 Check in?" :
          confirmAction === "checkout" ? "🚪 Check out?" : "✅ Mark complete?"
        ),
        React.createElement("div", { style: styles.confirmJob }, confirmJob.title),
        React.createElement("div", { style: { display: "flex", gap: 16, marginTop: 24 } },
          React.createElement("button", { style: styles.confirmYes, onClick: handleConfirm }, "Yes"),
          React.createElement("button", { style: styles.confirmNo, onClick: () => { setConfirmJob(null); setConfirmAction(null); } }, "Cancel")
        )
      )
    ),

    // ── Header ──────────────────────────────────────────────────────────
    React.createElement("div", { style: styles.header },
      React.createElement("div", { style: styles.headerLeft },
        React.createElement("div", { style: styles.headerTitle }, "🚗 Drive Mode"),
        React.createElement("div", { style: styles.headerSub }, jobs.length + " jobs today · " + displayMiles + " mi"),
      ),
      React.createElement("button", { onClick: onExit, style: styles.exitBtn }, "✕ Exit")
    ),

    // ── Job list ─────────────────────────────────────────────────────────
    React.createElement("div", { style: styles.jobList },
      !dayStarted && React.createElement("div", { style: styles.notStarted }, "Start your day first to enable check-ins"),
      sorted.map(job => {
        const nid = normalizeId(job.id);
        const status = getStatus(job);
        const sc = STATUS_COLORS[status];
        const ci = checkedIn[nid];
        const co = checkedOut[nid];

        return React.createElement("div", { key: job.id, style: { ...styles.jobCard, borderLeft: "6px solid " + sc.color } },
          // Left: job info
          React.createElement("div", { style: styles.jobInfo },
            React.createElement("div", { style: { ...styles.statusPill, background: sc.bg, color: sc.color } }, sc.label),
            React.createElement("div", { style: styles.jobTitle }, job.title),
            React.createElement("div", { style: styles.jobTime }, job.startTime + (job.endTime ? " – " + job.endTime : "")),
            job.location && React.createElement("div", { style: styles.jobLoc }, "📍 " + job.location.split(",").slice(0, 2).join(",")),
            (ci || co) && React.createElement("div", { style: styles.jobTimes },
              ci && React.createElement("span", null, "🟢 " + ci),
              co && React.createElement("span", null, "  🔴 " + co),
            ),
          ),

          // Right: action button
          React.createElement("div", { style: styles.actionCol },
            status === "Scheduled" && dayStarted &&
              React.createElement("button", { style: { ...styles.actionBtn, background: "#185FA5" }, onClick: () => handleTap(job, "checkin") }, "📍\nCheck In"),
            status === "Checked In" &&
              React.createElement("button", { style: { ...styles.actionBtn, background: "#633806" }, onClick: () => handleTap(job, "checkout") }, "🚪\nCheck Out"),
            status === "Checked Out" &&
              React.createElement("button", { style: { ...styles.actionBtn, background: "#27500A" }, onClick: () => handleTap(job, "complete") }, "✅\nDone"),
            status === "Done" &&
              React.createElement("div", { style: { ...styles.actionBtn, background: "#EAF3DE", color: "#27500A", fontSize: 28 } }, "✅"),
          )
        );
      })
    )
  );
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", background: "#0f0f0f", minHeight: "100vh", color: "#fff" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.5rem", background: "#1a1a2e", borderBottom: "1px solid #333" },
  headerLeft: {},
  headerTitle: { fontSize: 22, fontWeight: 700, color: "#7dd3fc" },
  headerSub: { fontSize: 13, color: "#888", marginTop: 2 },
  exitBtn: { fontSize: 15, color: "#888", textDecoration: "none", padding: "8px 16px", border: "1px solid #333", borderRadius: 8 },
  jobList: { padding: "1rem", display: "flex", flexDirection: "column", gap: 12 },
  notStarted: { textAlign: "center", color: "#666", fontSize: 15, padding: "2rem" },
  jobCard: { background: "#1e1e1e", borderRadius: 12, padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: 16 },
  jobInfo: { flex: 1, minWidth: 0 },
  statusPill: { fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, display: "inline-block", marginBottom: 6 },
  jobTitle: { fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 4 },
  jobTime: { fontSize: 14, color: "#aaa", marginBottom: 2 },
  jobLoc: { fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  jobTimes: { fontSize: 13, color: "#888", marginTop: 4 },
  actionCol: { flexShrink: 0 },
  actionBtn: { width: 90, height: 80, borderRadius: 12, border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, whiteSpace: "pre-line", textAlign: "center", lineHeight: 1.3 },
  confirmOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  confirmBox: { background: "#1e1e1e", borderRadius: 20, padding: "2.5rem", textAlign: "center", maxWidth: 360, width: "90%" },
  confirmTitle: { fontSize: 24, fontWeight: 700, color: "#fff", marginBottom: 12 },
  confirmJob: { fontSize: 18, color: "#aaa" },
  confirmYes: { flex: 1, padding: "16px", borderRadius: 12, background: "#185FA5", color: "#fff", border: "none", fontSize: 18, fontWeight: 700, cursor: "pointer" },
  confirmNo: { flex: 1, padding: "16px", borderRadius: 12, background: "#333", color: "#aaa", border: "none", fontSize: 18, cursor: "pointer" },
};
