import React from "react";
import { useGoogleLogin } from "@react-oauth/google";

export default function Login({ onLoginSuccess }) {
  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive profile email",
    onSuccess: async (tokenResponse) => {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + tokenResponse.access_token },
      });
      const profile = await profileRes.json();
      onLoginSuccess(profile, tokenResponse.access_token);
    },
    onError: () => alert("Google sign-in failed. Please try again."),
  });

  return (
    React.createElement("div", { style: styles.page },
      React.createElement("div", { style: styles.card },
        React.createElement("div", { style: styles.icon }, "\uD83D\uDD27"),
        React.createElement("h1", { style: styles.title }, "TechPortal"),
        React.createElement("p", { style: styles.subtitle }, "Sign in to view your jobs and schedule"),
        React.createElement("button", { style: styles.googleBtn, onClick: () => login() },
          React.createElement(GoogleIcon, null),
          "Sign in with Google"
        ),
        React.createElement("p", { style: styles.hint }, "Signing in grants access to your Google Calendar and Sheets.")
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
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f3", fontFamily: "system-ui, sans-serif" },
  card: { background: "#fff", borderRadius: 16, border: "0.5px solid #e0e0e0", padding: "2.5rem 2rem", width: 360, textAlign: "center" },
  icon: { fontSize: 36, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 600, margin: "0 0 6px", color: "#1a1a1a" },
  subtitle: { fontSize: 14, color: "#666", margin: "0 0 1.75rem" },
  googleBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "11px 16px", fontSize: 15, fontWeight: 500, background: "#fff", color: "#1a1a1a", border: "1px solid #dadce0", borderRadius: 8, cursor: "pointer", marginBottom: "1rem" },
  hint: { fontSize: 12, color: "#999", lineHeight: 1.6, margin: 0 },
};
