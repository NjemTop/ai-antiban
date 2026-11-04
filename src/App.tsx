import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@tauri-apps/api/core";
import { Dashboard } from "./components/Dashboard";
import { AlertPopup } from "./components/AlertPopup";
import "./App.css";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const [showBrowserSimulation, setShowBrowserSimulation] = useState<boolean>(false);

  useEffect(() => {
    // 1. Check URL parameters / hash (e.g. ?window=alert-popup or #alert-popup)
    const params = new URLSearchParams(window.location.search);
    const winParam = params.get("window");
    if (winParam === "alert-popup" || window.location.hash === "#alert-popup") {
      setWindowLabel("alert-popup");
      return;
    }

    // 2. In Tauri environment, inspect WebviewWindow label
    if (isTauri()) {
      try {
        const win = getCurrentWebviewWindow();
        setWindowLabel(win.label);
      } catch (err) {
        console.warn("Could not determine Tauri window label, defaulting to main:", err);
        setWindowLabel("main");
      }
    } else {
      setWindowLabel("main");
    }
  }, []);

  // When current window is alert-popup, render dedicated 480x420 popup
  if (windowLabel === "alert-popup") {
    return (
      <div className="w-full min-h-screen bg-[#0A0B0E] flex items-center justify-center">
        <AlertPopup />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-[#0A0B0E] flex items-center justify-center">
      <Dashboard onSimulateInBrowser={() => setShowBrowserSimulation(true)} />

      {/* Browser Dev simulation overlay */}
      {showBrowserSimulation && !isTauri() && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowBrowserSimulation(false)}
              className="absolute -top-3 -right-3 z-50 w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 hover:text-white border border-white/[0.1] flex items-center justify-center text-xs font-mono cursor-pointer"
            >
              ✕
            </button>
            <AlertPopup onResolved={() => setShowBrowserSimulation(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
