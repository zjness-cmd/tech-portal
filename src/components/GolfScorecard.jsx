import React, { useState } from "react";

// Course database — edit pars here to match actual scorecards
const COURSES = {
  custom: {
    name: "Custom Course",
    holes: 18,
    pars: [4,4,3,4,5,4,3,5,4,4,4,3,4,5,4,3,5,4],
  },
  riverwood: {
    name: "Riverwood National",
    location: "Otsego, MN",
    holes: 18,
    pars: [4,4,3,5,4,3,4,5,4,4,3,4,5,4,3,4,4,5], // Par 72 — edit to match scorecard
  },
  vintage: {
    name: "Vintage Golf Course",
    location: "Otsego, MN",
    holes: 18,
    pars: [3,3,4,3,3,3,4,3,3,3,3,4,3,3,3,4,3,3], // Par 58 executive — edit to match scorecard
  },
  ponds_red: {
    name: "The Ponds (Red 9)",
    location: "St. Francis, MN",
    holes: 9,
    pars: [4,4,3,4,5,4,3,5,4],  // Par 36 — edit to match scorecard
  },
  ponds_white: {
    name: "The Ponds (White 9)",
    location: "St. Francis, MN",
    holes: 9,
    pars: [4,3,4,5,3,4,4,5,4], // Par 36 — edit to match scorecard
  },
  refuge: {
    name: "The Refuge",
    location: "Oak Grove, MN",
    holes: 18,
    pars: [4,3,4,5,4,3,4,5,4,4,3,5,4,4,3,5,4,4], // Par 72 — edit to match scorecard
  },
};

export default function GolfScorecard() {
  const [selectedCourse, setSelectedCourse] = useState("custom");
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [customCourses, setCustomCourses] = useState({});
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseHoles, setNewCourseHoles] = useState(18);
  const [newCoursePars, setNewCoursePars] = useState(Array(18).fill(4));

  const [p1name, setP1name] = useState("Player 1");
  const [p2name, setP2name] = useState("Player 2");
  const [scores, setScores] = useState({ p1: Array(18).fill(""), p2: Array(18).fill("") });
  const [editingPars, setEditingPars] = useState(false);
  const [courseParOverrides, setCourseParOverrides] = useState({});

  const allCourses = { ...COURSES, ...customCourses };
  const course = allCourses[selectedCourse];
  const holes = course.holes;
  const basePars = courseParOverrides[selectedCourse] || course.pars;
  const pars = basePars.slice(0, holes);

  const updatePar = (hole, value) => {
    const current = courseParOverrides[selectedCourse] || [...course.pars];
    const updated = [...current];
    updated[hole] = parseInt(value) || 4;
    setCourseParOverrides({ ...courseParOverrides, [selectedCourse]: updated });
  };

  const getScore = (player, hole) => {
    const v = scores[player][hole];
    return v === "" ? null : parseInt(v);
  };

  const updateScore = (player, hole, value) => {
    const newScores = { ...scores, [player]: [...scores[player]] };
    newScores[player][hole] = value;
    setScores(newScores);
  };

  const selectCourse = (key) => {
    setSelectedCourse(key);
    setScores({ p1: Array(18).fill(""), p2: Array(18).fill("") });
    setShowCourseModal(false);
  };

  const saveCustomCourse = () => {
    if (!newCourseName.trim()) return;
    const key = "custom_" + Date.now();
    setCustomCourses({
      ...customCourses,
      [key]: {
        name: newCourseName.trim(),
        holes: newCourseHoles,
        pars: newCoursePars.slice(0, newCourseHoles),
      }
    });
    setShowAddCourse(false);
    setNewCourseName("");
    setNewCoursePars(Array(18).fill(4));
    selectCourse(key);
  };

  const calcBetting = () => {
    let carryover = 0;
    let p1money = 0;
    let p2money = 0;
    let p1wins = 0;
    let p2wins = 0;
    let results = [];

    for (let i = 0; i < holes; i++) {
      const s1 = getScore("p1", i);
      const s2 = getScore("p2", i);
      const par = pars[i];
      const pot = 1 + carryover;

      if (s1 === null || s2 === null) {
        results.push({ winner: null, pot, carryover });
        continue;
      }

      if (s1 < s2) {
        let bonus = 0;
        if (s1 <= par - 1) bonus = 4;
        else if (s1 === par) bonus = 2;
        const winAmount = pot + bonus;
        p1money += winAmount;
        p2money -= winAmount;
        p1wins++;
        results.push({ winner: 1, amount: winAmount, pot, carryover, bonus, s1, s2, par });
        carryover = 0;
      } else if (s2 < s1) {
        let bonus = 0;
        if (s2 <= par - 1) bonus = 4;
        else if (s2 === par) bonus = 2;
        const winAmount = pot + bonus;
        p2money += winAmount;
        p1money -= winAmount;
        p2wins++;
        results.push({ winner: 2, amount: winAmount, pot, carryover, bonus, s1, s2, par });
        carryover = 0;
      } else {
        carryover += 1;
        results.push({ winner: 0, pot, carryover, s1, s2, par });
      }
    }

    return { p1money, p2money, p1wins, p2wins, results, carryover };
  };

  const resetScores = () => setScores({ p1: Array(18).fill(""), p2: Array(18).fill("") });

  const { p1money, p2money, p1wins, p2wins, results, carryover } = calcBetting();
  const fmt = v => (v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(2);
  const moneyColor = v => v > 0 ? "#27500A" : v < 0 ? "#A32D2D" : "#888";
  const playedHoles = results.filter(r => r.s1 !== undefined && r.s1 !== null).length;

  const front9 = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back9 = holes > 9 ? Array.from({ length: holes - 9 }, (_, i) => i + 9) : [];

  const holeTotal = (player, from, to) =>
    scores[player].slice(from, to).reduce((a, v) => a + (v === "" ? 0 : parseInt(v)), 0);
  const parTotal = (from, to) => pars.slice(from, to).reduce((a, v) => a + v, 0);

  const renderHoleRows = (holeIndices) => holeIndices.map(i => {
    const r = results[i] || { winner: null, pot: 1, carryover: 0 };
    let resultEl = null;
    if (r.winner === 1) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#EAF3DE", color: "#27500A" } },
        p1name + " +$" + r.amount + (r.bonus > 0 ? (r.s1 <= r.par - 1 ? " 🦅" : " par!") : "")
      );
    } else if (r.winner === 2) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#EAF3DE", color: "#27500A" } },
        p2name + " +$" + r.amount + (r.bonus > 0 ? (r.s2 <= r.par - 1 ? " 🦅" : " par!") : "")
      );
    } else if (r.winner === 0) {
      resultEl = React.createElement("span", { style: { ...styles.badge, background: "#FAEEDA", color: "#633806" } },
        "Carry →$" + r.carryover
      );
    }
    return React.createElement("tr", { key: i, style: styles.tr },
      React.createElement("td", { style: styles.td }, React.createElement("span", { style: styles.holeNum }, i + 1)),
      React.createElement("td", { style: styles.td },
        editingPars
          ? React.createElement("input", { style: { ...styles.scoreInput, width: 36 }, type: "number", min: 3, max: 6, value: pars[i], onChange: e => updatePar(i, e.target.value) })
          : React.createElement("span", { style: { color: "#888", fontSize: 13 } }, pars[i])
      ),
      React.createElement("td", { style: styles.td },
        React.createElement("input", { style: styles.scoreInput, type: "number", min: 1, max: 15, value: scores.p1[i], onChange: e => updateScore("p1", i, e.target.value) })
      ),
      React.createElement("td", { style: styles.td },
        React.createElement("input", { style: styles.scoreInput, type: "number", min: 1, max: 15, value: scores.p2[i], onChange: e => updateScore("p2", i, e.target.value) })
      ),
      React.createElement("td", { style: { ...styles.td, minWidth: 130 } }, resultEl),
      React.createElement("td", { style: { ...styles.td, fontSize: 11, color: "#888" } }, "$" + r.pot)
    );
  });

  return React.createElement("div", { style: styles.page },

    // Course selector modal
    showCourseModal && React.createElement("div", { style: styles.overlay, onClick: () => setShowCourseModal(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Select Course"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowCourseModal(false) }, "×")
        ),
        Object.entries(allCourses).map(([key, c]) =>
          React.createElement("div", { key, style: { ...styles.courseRow, ...(key === selectedCourse ? styles.courseRowActive : {}) }, onClick: () => selectCourse(key) },
            React.createElement("div", { style: styles.courseName }, c.name),
            React.createElement("div", { style: styles.courseMeta }, (c.location || "") + (c.location ? " · " : "") + c.holes + " holes · Par " + c.pars.slice(0, c.holes).reduce((a, v) => a + v, 0))
          )
        ),
        React.createElement("div", { style: { padding: "0.75rem 1.25rem", borderTop: "0.5px solid #e0e0e0" } },
          React.createElement("button", { style: { ...styles.btn, width: "100%", textAlign: "center" }, onClick: () => { setShowAddCourse(true); setShowCourseModal(false); } }, "+ Add Custom Course")
        )
      )
    ),

    // Add custom course modal
    showAddCourse && React.createElement("div", { style: styles.overlay, onClick: () => setShowAddCourse(false) },
      React.createElement("div", { style: styles.modal, onClick: e => e.stopPropagation() },
        React.createElement("div", { style: styles.modalHeader },
          React.createElement("div", { style: styles.modalTitle }, "Add Custom Course"),
          React.createElement("button", { style: styles.modalClose, onClick: () => setShowAddCourse(false) }, "×")
        ),
        React.createElement("div", { style: { padding: "1rem 1.25rem" } },
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Course name"),
            React.createElement("input", { style: styles.input, type: "text", placeholder: "e.g. Elk River Golf Club", value: newCourseName, onChange: e => setNewCourseName(e.target.value) })
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Number of holes"),
            React.createElement("select", { style: styles.input, value: newCourseHoles, onChange: e => { const h = parseInt(e.target.value); setNewCourseHoles(h); setNewCoursePars(Array(h).fill(4)); } },
              React.createElement("option", { value: 9 }, "9 holes"),
              React.createElement("option", { value: 18 }, "18 holes")
            )
          ),
          React.createElement("div", { style: styles.fieldGroup },
            React.createElement("label", { style: styles.fieldLabel }, "Par for each hole"),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 } },
              Array.from({ length: newCourseHoles }, (_, i) =>
                React.createElement("div", { key: i, style: { textAlign: "center" } },
                  React.createElement("div", { style: { fontSize: 10, color: "#888", marginBottom: 2 } }, i + 1),
                  React.createElement("input", { style: { ...styles.scoreInput, width: "100%", fontSize: 13 }, type: "number", min: 3, max: 6, value: newCoursePars[i], onChange: e => { const p = [...newCoursePars]; p[i] = parseInt(e.target.value) || 4; setNewCoursePars(p); } })
                )
              )
            )
          ),
          React.createElement("button", { style: { ...styles.btn, background: "#185FA5", color: "#fff", width: "100%", textAlign: "center", marginTop: 8 }, onClick: saveCustomCourse }, "Save Course")
        )
      )
    ),

    // Header
    React.createElement("div", { style: styles.header },
      React.createElement("div", null,
        React.createElement("div", { style: styles.title }, "⛳ Golf Scorecard"),
        React.createElement("button", { style: styles.courseBtn, onClick: () => setShowCourseModal(true) },
          course.name + " ▾"
        )
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        React.createElement("button", { style: styles.btn, onClick: () => setEditingPars(!editingPars) }, editingPars ? "Done" : "Edit Pars"),
        React.createElement("button", { style: { ...styles.btn, color: "#A32D2D" }, onClick: resetScores }, "Reset")
      )
    ),

    // Player cards
    React.createElement("div", { style: styles.playerGrid },
      React.createElement("div", { style: styles.playerCard },
        React.createElement("input", { style: styles.nameInput, value: p1name, onChange: e => setP1name(e.target.value) }),
        React.createElement("div", { style: { fontSize: 28, fontWeight: 500, color: moneyColor(p1money) } }, fmt(p1money)),
        React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, p1wins + " hole" + (p1wins !== 1 ? "s" : "") + " won")
      ),
      React.createElement("div", { style: styles.playerCard },
        React.createElement("input", { style: styles.nameInput, value: p2name, onChange: e => setP2name(e.target.value) }),
        React.createElement("div", { style: { fontSize: 28, fontWeight: 500, color: moneyColor(p2money) } }, fmt(p2money)),
        React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, p2wins + " hole" + (p2wins !== 1 ? "s" : "") + " won")
      )
    ),

    carryover > 0 && React.createElement("div", { style: styles.carryBanner },
      "⚡ Active carryover: $" + carryover + " rolls into next hole"
    ),

    // Front 9
    React.createElement("div", { style: styles.tableWrap },
      React.createElement("div", { style: styles.sectionLabel }, "Front 9"),
      React.createElement("table", { style: styles.table },
        React.createElement("thead", null,
          React.createElement("tr", null,
            ["Hole","Par",p1name,p2name,"Result","Pot"].map(h => React.createElement("th", { key: h, style: styles.th }, h))
          )
        ),
        React.createElement("tbody", null, renderHoleRows(front9)),
        React.createElement("tfoot", null,
          React.createElement("tr", { style: { background: "#f5f5f3" } },
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, "OUT"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, parTotal(0, 9)),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p1", 0, 9) || "-"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p2", 0, 9) || "-"),
            React.createElement("td", { style: styles.td }),
            React.createElement("td", { style: styles.td })
          )
        )
      )
    ),

    // Back 9
    back9.length > 0 && React.createElement("div", { style: styles.tableWrap },
      React.createElement("div", { style: styles.sectionLabel }, "Back 9"),
      React.createElement("table", { style: styles.table },
        React.createElement("thead", null,
          React.createElement("tr", null,
            ["Hole","Par",p1name,p2name,"Result","Pot"].map(h => React.createElement("th", { key: h, style: styles.th }, h))
          )
        ),
        React.createElement("tbody", null, renderHoleRows(back9)),
        React.createElement("tfoot", null,
          React.createElement("tr", { style: { background: "#f5f5f3" } },
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, "IN"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, parTotal(9, 18)),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p1", 9, 18) || "-"),
            React.createElement("td", { style: { ...styles.td, fontWeight: 500 } }, holeTotal("p2", 9, 18) || "-"),
            React.createElement("td", { style: styles.td }),
            React.createElement("td", { style: styles.td })
          )
        )
      )
    ),

    // Summary
    playedHoles > 0 && React.createElement("div", { style: styles.summary },
      React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, "Holes played"),
        React.createElement("span", { style: styles.summaryVal }, playedHoles + " / " + holes)
      ),
      React.createElement("div", { style: { ...styles.summaryRow, borderTop: "0.5px solid #e0e0e0", paddingTop: 8, marginTop: 4 } },
        React.createElement("span", { style: styles.summaryLabel }, p1name),
        React.createElement("span", { style: { fontWeight: 500, color: moneyColor(p1money) } }, fmt(p1money))
      ),
      React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, p2name),
        React.createElement("span", { style: { fontWeight: 500, color: moneyColor(p2money) } }, fmt(p2money))
      ),
      carryover > 0 && React.createElement("div", { style: styles.summaryRow },
        React.createElement("span", { style: styles.summaryLabel }, "Outstanding carryover"),
        React.createElement("span", { style: styles.summaryVal }, "$" + carryover)
      )
    )
  );
}
// Add this function inside the component
const downloadCSV = () => {
  const date = new Date().toLocaleDateString("en-US");
  const rows = [
    ["Date", "Course", "Hole", "Par", p1name, p2name, "Winner", "Amount"],
    ...Array.from({ length: holes }, (_, i) => {
      const r = results[i] || {};
      const s1 = scores.p1[i] || "";
      const s2 = scores.p2[i] || "";
      const winner = r.winner === 1 ? p1name : r.winner === 2 ? p2name : r.winner === 0 ? "Tie/Carry" : "";
      const amount = r.amount ? "$" + r.amount : "";
      return [date, course.name, i + 1, pars[i], s1, s2, winner, amount];
    }),
    [],
    ["", "", "TOTAL", parTotal(0, holes), holeTotal("p1", 0, holes), holeTotal("p2", 0, holes), "", ""],
    ["", "", p1name + " winnings", "", "", "", "", fmt(p1money)],
    ["", "", p2name + " winnings", "", "", "", "", fmt(p2money)],
  ];

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = course.name + " " + new Date().toLocaleDateString("en-US").replace(/\//g, "-") + ".csv";
  a.click();
  URL.revokeObjectURL(url);
};
const styles = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 680, margin: "0 auto", padding: "1rem", paddingBottom: "3rem" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: 8 },
  title: { fontSize: 20, fontWeight: 500, color: "#1a1a1a", marginBottom: 4 },
  courseBtn: { fontSize: 13, padding: "5px 10px", borderRadius: 8, border: "0.5px solid #185FA5", background: "#f0f4ff", color: "#185FA5", cursor: "pointer", fontWeight: 500 },
  btn: { fontSize: 12, padding: "6px 12px", borderRadius: 8, border: "0.5px solid #ccc", background: "#fff", cursor: "pointer", color: "#1a1a1a" },
  playerGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1rem" },
  playerCard: { background: "#f5f5f3", borderRadius: 12, padding: "12px 16px" },
  nameInput: { background: "none", border: "none", borderBottom: "0.5px solid #ccc", fontSize: 14, fontWeight: 500, color: "#1a1a1a", width: "100%", outline: "none", marginBottom: 6, padding: "2px 0" },
  carryBanner: { background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: "1rem" },
  tableWrap: { marginBottom: "1.5rem" },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { background: "#185FA5", color: "white", padding: "7px 6px", textAlign: "center", fontSize: 12, fontWeight: 500 },
  tr: { borderBottom: "0.5px solid #e0e0e0" },
  td: { padding: "5px 4px", textAlign: "center", fontSize: 13 },
  holeNum: { fontSize: 12, color: "#888", fontWeight: 500 },
  scoreInput: { width: 40, height: 32, textAlign: "center", fontSize: 14, fontWeight: 500, border: "0.5px solid #ccc", borderRadius: 6, background: "#fff", color: "#1a1a1a" },
  badge: { fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap" },
  summary: { background: "#f5f5f3", borderRadius: 12, padding: "1rem" },
  summaryRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" },
  summaryLabel: { color: "#888" },
  summaryVal: { fontWeight: 500, color: "#1a1a1a" },
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "0.5px solid #e0e0e0" },
  modalTitle: { fontSize: 15, fontWeight: 600, color: "#1a1a1a" },
  modalClose: { fontSize: 22, background: "none", border: "none", cursor: "pointer", color: "#888" },
  courseRow: { padding: "0.85rem 1.25rem", borderBottom: "0.5px solid #f0f0f0", cursor: "pointer" },
  courseRowActive: { background: "#f0f4ff" },
  courseName: { fontSize: 14, fontWeight: 500, color: "#1a1a1a", marginBottom: 2 },
  courseMeta: { fontSize: 12, color: "#888" },
  fieldGroup: { marginBottom: "0.75rem" },
  fieldLabel: { fontSize: 12, color: "#888", display: "block", marginBottom: 4 },
  input: { width: "100%", padding: "9px 12px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 8, background: "#fff", color: "#1a1a1a", boxSizing: "border-box" },
};
