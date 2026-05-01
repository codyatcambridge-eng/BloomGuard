import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { startLabelQueueUploader } from '@/lib/label-queue';

const SABCODY_BOOT_MARKER = 'SABCODY-2026-04-07-01';
const GOD1_BOOT_MARKER = 'GOD1-2026-04-30-01';
const ENDURE1_BOOT_MARKER = 'ENDURE1-2026-04-30-01';

declare global {
  interface Window {
    __MW_LABEL_UPLOADER_STARTED__?: boolean;
  }
}

if (typeof window !== 'undefined') {
  console.log('[SABCODY] app_boot', SABCODY_BOOT_MARKER, 'mode=' + String(import.meta.env.MODE || 'unknown'));
  console.log('[DIAG][APP_BOOT] GOD1', GOD1_BOOT_MARKER, 'mode=' + String(import.meta.env.MODE || 'unknown'));
  console.log('[DIAG][APP_BOOT] ENDURE1', ENDURE1_BOOT_MARKER, 'mode=' + String(import.meta.env.MODE || 'unknown'));
}

if (typeof window !== 'undefined' && !window.__MW_LABEL_UPLOADER_STARTED__) {
  window.__MW_LABEL_UPLOADER_STARTED__ = true;
  startLabelQueueUploader();
}

createRoot(document.getElementById("root")!).render(<App />);
