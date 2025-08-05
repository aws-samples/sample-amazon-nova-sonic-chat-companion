import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

const intervalMS = 60 * 60 * 1000;

// Register service worker
const updateSW = registerSW({
  onNeedRefresh() {
    // Show a prompt to the user asking if they want to update
    if (confirm("New content available. Reload?")) {
      updateSW(true);
    }
  },
  onRegistered(r) {
    r &&
      setInterval(() => {
        r.update();
      }, intervalMS);
  },
  onOfflineReady() {
    console.log("App ready to work offline");
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
