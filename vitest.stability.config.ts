import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Dedicated config for YouTube DOM stability tests.
// Sets jsdom URL to m.youtube.com so surface-detection and platform checks
// inside the injection script resolve correctly during test execution.
// Run with: npx vitest run --config vitest.stability.config.ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://m.youtube.com/",
      },
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/test/stability/**/*.test.ts",
      "src/test/flash-shield.golden.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
