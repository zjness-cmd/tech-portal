import React from "react";

// Login now receives the `onLogin` function from App.jsx
// (the useGoogleLogin hook lives in App so it can auto-refresh tokens)
export default function Login({ onLogin, authError }) {
  return (
    React.createElement("div", { style: styles.page },
      React.createElement("div", { style: styles.bgOverlay }),
      React.createElement("div", { style: styles.content },
        React.createElement("img", {
          src: "https://tapbeercleaning.com/img/loch_ness2.png",
          alt: "Ness Draft Beer Service",
          style: styles.logo
        }),
        React.createElement("div", { style: styles.divider }),
        React.createElement("div", { style: styles.tagline }, "Technician Portal"),
        React.createElement("button", { style: styles.googleBtn, onClick: () => onLogin() },
          React.createElement(GoogleIcon, null),
          "Sign in with Google"
        ),
        authError
          ? React.createElement("p", { style: styles.errorHint }, "⛔ " + authError)
          : React.createElement("p", { style: styles.hint }, "Access your jobs, routes, and invoices")
      )
    )
  );
}

function GoogleIcon() {
  return React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 18 18", style: { marginRight: 10 } },
    React.createElement("path", { fill: "#4285F4", d: "M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" }),
    React.createElement("path", { fill: "#34A853", d: "M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" }),
    React.createElement("path", { fill: "#FBBC05", d: "M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" }),
    React.createElement("path", { fill: "#EA4335", d: "M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" })
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0a0f1e 0%, #1a2744 50%, #0d1b2a 100%)",
    fontFamily: "system-ui, sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  bgOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "radial-gradient(ellipse at 50% 0%, rgba(24, 95, 165, 0.15) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  content: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "2.5rem 2rem",
    width: "100%",
    maxWidth: 380,
  },
  logo: {
    width: 240,
    maxWidth: "80vw",
    marginBottom: "1.5rem",
    filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.5))",
  },
  divider: {
    width: 40,
    height: 2,
    background: "linear-gradient(90deg, transparent, #185FA5, transparent)",
    marginBottom: "1rem",
  },
  tagline: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    marginBottom: "2.5rem",
  },
  googleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "13px 20px",
    fontSize: 15,
    fontWeight: 500,
    background: "#fff",
    color: "#1a1a1a",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    marginBottom: "1rem",
  },
  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.3)",
    margin: 0,
    textAlign: "center",
  },
  errorHint: {
    fontSize: 13,
    color: "#ff6b6b",
    margin: 0,
    textAlign: "center",
    lineHeight: 1.5,
    padding: "0 1rem",
  },
};
