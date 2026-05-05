import React, { useState, useEffect } from "react";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem("tech_user");
    const savedToken = localStorage.getItem("google_token");
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setAccessToken(savedToken);
    }
  }, []);

  const handleLoginSuccess = (googleUser, token) => {
    setUser(googleUser);
    setAccessToken(token);
    localStorage.setItem("tech_user", JSON.stringify(googleUser));
    localStorage.setItem("google_token", token);
  };

  const handleLogout = () => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem("tech_user");
    localStorage.removeItem("google_token");
  };

  return (
    <div className="app">
      {!user ? (
        <Login onLoginSuccess={handleLoginSuccess} />
      ) : (
        <Dashboard user={user} accessToken={accessToken} onLogout={handleLogout} />
      )}
    </div>
  );
}