import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import GolfScorecard from "./components/GolfScorecard";

const ALLOWED_EMAILS = ["mjness@gmail.com", "zjness@gmail.com"];

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "profile",
  "email",
].join(" ");

const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // refresh every 50 min (token lasts 60)

export default function App() {
  const [user, setUser]           = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [refreshError, setRefreshError] = useState(false);
  const dashboardRef   = useRef(null);
  const refreshTimer   = useRef(null);
  // Guards against two concurrent /api/refresh calls — seen in the field as
  // two "accessToken updated" log entries 18 seconds apart, more than the
  // scheduled 50-min interval would produce on its own. The scheduled
  // timer, the visibilitychange listener, and the online listener can all
  // ask for a refresh independently and land close together; without this,
  // two in-flight requests both succeed and race to set state, which is
  // harmless by itself but wasteful and makes the debug log confusing.
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const isGolfPage = window.location.pathname === "/golf";

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Silent token refresh — calls /api/refresh which uses the httpOnly cookie
  const silentRefresh = useCallback(async (retryCount = 0) => {
    // Only the initial call (not a scheduled retry continuing the same
    // attempt) checks/acquires the lock — retries need to run regardless,
    // since they're part of an attempt that already holds it.
    if (retryCount === 0) {
      if (refreshInFlightRef.current) {
        refreshQueuedRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
    }
    const release = () => {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        silentRefresh();
      }
    };
    try {
      console.log("[TechPortal] Silently refreshing token" + (retryCount ? " (retry " + retryCount + ")" : "") + "...");
      const res = await fetch("/api/refresh", { method: "POST" });
      if (res.status === 401) {
        // The refresh token itself is invalid/revoked (Google said so
        // explicitly) — no amount of retrying fixes that, only a real
        // sign-in will. Fail fast here instead of burning retries on it.
        const err = new Error("Refresh token invalid");
        err.fatal = true;
        throw err;
      }
      if (!res.ok) throw new Error("Refresh failed: " + res.status);
      const { access_token } = await res.json();
      setAccessToken(access_token);
      localStorage.setItem("google_token", access_token);
      localStorage.setItem("google_token_expiry", (Date.now() + 58 * 60 * 1000).toString());
      setRefreshError(false);
      console.log("[TechPortal] Token refreshed silently ✅");
      release();
    } catch (e) {
      console.error("[TechPortal] Silent refresh failed:", e.message);
      // A plain network blip (fetch throwing "Failed to fetch" — common on
      // spotty signal at a job site) isn't a real session problem. Retry a
      // few times with backoff before showing the "sign in again" banner;
      // only skip straight to the banner if the server told us the refresh
      // token is actually dead (401, marked .fatal above).
      if (!e.fatal && retryCount < 3) {
        setTimeout(() => silentRefresh(retryCount + 1), (retryCount + 1) * 5000);
        return; // still in flight — don't release the lock yet
      }
      setRefreshError(true);
      release();
    }
  }, []);

  // Start auto-refresh timer
  const startRefreshTimer = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(silentRefresh, REFRESH_INTERVAL_MS);
    console.log("[TechPortal] Auto-refresh timer started (every 50 min)");
  }, [silentRefresh]);

  // Recover as soon as possible instead of waiting for the next scheduled
  // 50-min tick. Two real scenarios this catches: (1) the phone was
  // backgrounded/screen-locked through a long job — Android/Chrome throttle
  // or fully suspend JS timers on hidden tabs, so the interval can silently
  // miss its window entirely while backgrounded; (2) a transient dead zone
  // caused the last scheduled refresh to fail and show the "sign in again"
  // banner even though the underlying refresh token was fine the whole
  // time. Both cases just need "try again now" — the tab becoming visible
  // again, or the device regaining connectivity, are exactly the right
  // moments to retry immediately rather than sit on a stale/failed state.
  useEffect(() => {
    const tryRecover = () => {
      if (document.visibilityState !== "visible" || !accessToken) return;
      const expiry = parseInt(localStorage.getItem("google_token_expiry") || "0");
      if (Date.now() > expiry - 5 * 60 * 1000) {
        console.log("[TechPortal] App resumed/reconnected — checking token freshness...");
        silentRefresh();
      }
    };
    document.addEventListener("visibilitychange", tryRecover);
    window.addEventListener("online", tryRecover);
    return () => {
      document.removeEventListener("visibilitychange", tryRecover);
      window.removeEventListener("online", tryRecover);
    };
  }, [accessToken, silentRefresh]);

  // Auth-code login — gets refresh token from Google
  const login = useGoogleLogin({
    flow: "auth-code",
    scope: SCOPES,
    onSuccess: async ({ code }) => {
      try {
        // Exchange code for tokens via our backend
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setAuthError("Auth failed: " + (data.detail || data.error));
          return;
        }

        // Get user profile
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + data.access_token },
        });
        const profile = await profileRes.json();

        if (!ALLOWED_EMAILS.includes(profile.email)) {
          setAuthError("Access denied for " + profile.email);
          return;
        }

        // Save session
        setUser(profile);
        setAccessToken(data.access_token);
        setAuthError(null);
        setRefreshError(false);
        localStorage.setItem("tech_user", JSON.stringify(profile));
        localStorage.setItem("google_token", data.access_token);
        localStorage.setItem("google_token_expiry", (Date.now() + 58 * 60 * 1000).toString());
        startRefreshTimer();
        console.log("[TechPortal] Logged in, auto-refresh active");
      } catch (e) {
        setAuthError("Login error: " + e.message);
      }
    },
    onError: () => setAuthError("Google sign-in failed. Please try again."),
  });

  // Restore session on page load + try silent refresh
  useEffect(() => {
    const savedUser   = localStorage.getItem("tech_user");
    const savedToken  = localStorage.getItem("google_token");
    const savedExpiry = parseInt(localStorage.getItem("google_token_expiry") || "0");

    if (savedUser && savedToken && Date.now() < savedExpiry) {
      setUser(JSON.parse(savedUser));
      setAccessToken(savedToken);
      startRefreshTimer();
      console.log("[TechPortal] Session restored from localStorage");

      // If token has less than 10 min left, refresh immediately
      const minsLeft = Math.round((savedExpiry - Date.now()) / 60000);
      if (minsLeft < 10) {
        console.log("[TechPortal] Token nearly expired, refreshing now...");
        silentRefresh();
      }
    } else if (savedUser) {
      // Token expired but we might have a refresh cookie — try silent refresh
      console.log("[TechPortal] Token expired, attempting silent refresh...");
      silentRefresh().then(() => {
        const newToken = localStorage.getItem("google_token");
        if (newToken) {
          setUser(JSON.parse(savedUser));
          setAccessToken(newToken);
          startRefreshTimer();
        } else {
          // Refresh failed — clear everything
          localStorage.removeItem("tech_user");
          localStorage.removeItem("google_token");
          localStorage.removeItem("google_token_expiry");
        }
      });
    }

    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, []);

  const handleLogout = async () => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (dashboardRef.current?.flushPending) {
      try { await dashboardRef.current.flushPending(); } catch {}
    }
    setUser(null);
    setAccessToken(null);
    setAuthError(null);
    setRefreshError(false);
    localStorage.removeItem("tech_user");
    localStorage.removeItem("google_token");
    localStorage.removeItem("google_token_expiry");
  };

  if (isGolfPage) return React.createElement(GolfScorecard, null);

  return (
    <div className="app">
      {!user ? (
        <Login onLogin={login} authError={authError} />
      ) : (
        <>
          {/* PWA install banner */}
          {installPrompt && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "#185FA5", color: "#fff", fontSize: 13, fontWeight: 500, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontFamily: "system-ui, sans-serif" }}>
              <span>📲 Install TechPortal as an app</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={async () => { installPrompt.prompt(); const { outcome } = await installPrompt.userChoice; setInstallPrompt(null); }} style={{ fontSize: 13, fontWeight: 600, padding: "5px 14px", borderRadius: 6, background: "#fff", color: "#185FA5", border: "none", cursor: "pointer" }}>Install</button>
                <button onClick={() => setInstallPrompt(null)} style={{ fontSize: 13, padding: "5px 10px", borderRadius: 6, background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", cursor: "pointer" }}>✕</button>
              </div>
            </div>
          )}

          {/* Refresh error banner — only shows if silent refresh failed */}
          {refreshError && (
            <div onClick={() => { setRefreshError(false); login(); }} style={{
              position: "fixed", top: installPrompt ? 44 : 0, left: 0, right: 0, zIndex: 9998,
              background: "#c0392b", color: "#fff", fontSize: 13, fontWeight: 600,
              padding: "10px 20px", textAlign: "center", cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}>
              ⚠️ Session could not auto-renew — tap to sign in again
            </div>
          )}

          <div style={{ paddingTop: installPrompt ? 44 : refreshError ? 40 : 0 }}>
            <Dashboard ref={dashboardRef} user={user} accessToken={accessToken} onLogout={handleLogout} />
          </div>
        </>
      )}
    </div>
  );
}
