import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { startLabelQueueUploader } from '@/lib/label-queue';

declare global {
  interface Window {
    __MW_LABEL_UPLOADER_STARTED__?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__MW_LABEL_UPLOADER_STARTED__) {
  window.__MW_LABEL_UPLOADER_STARTED__ = true;
  startLabelQueueUploader();
}

createRoot(document.getElementById("root")!).render(<App />);
