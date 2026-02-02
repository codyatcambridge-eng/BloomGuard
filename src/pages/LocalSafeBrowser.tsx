import { NativeWebViewBrowser } from "@/components/browser/NativeWebViewBrowser";

/**
 * LocalSafeBrowser - Redirects to the unified NativeWebViewBrowser
 * Kept for backwards compatibility with routing
 */
const LocalSafeBrowser = () => {
  return <NativeWebViewBrowser />;
};

export default LocalSafeBrowser;
