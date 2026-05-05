import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";

const GOOGLE_CLIENT_ID = "629361530934-d1eumere8t4b39vf2c3so9rmlja5feob.apps.googleusercontent.com";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(React.StrictMode, null,
    React.createElement(GoogleOAuthProvider, { clientId: GOOGLE_CLIENT_ID },
      React.createElement(App, null)
    )
  )
);
