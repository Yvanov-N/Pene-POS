import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";

// Dev-only console diagnostic -- never included in a production build (the
// whole testOfflineSync module, and its Supabase/db imports, get tree-shaken
// out of that bundle since this branch is statically false there). Run
// `await __TEST_OFFLINE_SYNC__()` in the console to verify the offline sync
// engine end-to-end; see lib/testOfflineSync.ts for exactly what it does.
if (import.meta.env.DEV) {
  void import("./lib/testOfflineSync").then(({ testOfflineSync }) => {
    (window as typeof window & { __TEST_OFFLINE_SYNC__: typeof testOfflineSync }).__TEST_OFFLINE_SYNC__ =
      testOfflineSync;
    console.log("[dev] window.__TEST_OFFLINE_SYNC__() is available -- run it to verify the offline sync engine.");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
