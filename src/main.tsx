import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { startLabelQueueUploader } from '@/lib/label-queue';

const SABCODY_BOOT_MARKER = 'SABCODY-2026-04-07-01';
const CODYMVP_RUNTIME_DIAG_MARKER = 'codyMVP';

declare global {
  interface Window {
    __MW_LABEL_UPLOADER_STARTED__?: boolean;
  }
}

if (typeof window !== 'undefined') {
  console.log('[SABCODY] app_boot', SABCODY_BOOT_MARKER, 'mode=' + String(import.meta.env.MODE || 'unknown'));
  console.log(
    '[' + CODYMVP_RUNTIME_DIAG_MARKER + '] runtime_marker',
    'sha=' + String(__CODYMVP_GIT_SHA__ || 'unknown'),
    'builtAt=' + String(__CODYMVP_BUILD_TIME__ || 'unknown'),
  );
}

if (typeof window !== 'undefined' && !window.__MW_LABEL_UPLOADER_STARTED__) {
  window.__MW_LABEL_UPLOADER_STARTED__ = true;
  startLabelQueueUploader();
}

createRoot(document.getElementById("root")!).render(<App />);
