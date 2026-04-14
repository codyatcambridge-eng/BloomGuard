import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "node:child_process";

const CODYMVP_GIT_SHA = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
})();

const CODYMVP_BUILD_TIME = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer/",
    },
  },
  define: {
    "global.Buffer": ["buffer", "Buffer"],
    __CODYMVP_GIT_SHA__: JSON.stringify(CODYMVP_GIT_SHA),
    __CODYMVP_BUILD_TIME__: JSON.stringify(CODYMVP_BUILD_TIME),
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  build: {
    sourcemap: true,
  },
}));
