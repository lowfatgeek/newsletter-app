import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  use: { baseURL: "http://localhost:4321" },
  webServer: {
    command: "npm run seed && npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 60_000,
    // Timer e2e deterministik: unlock 100ms, dan server menerima token
    // berusia >= 100ms (lihat src/lib/timer.ts MIN_AGE_MS).
    env: { ...process.env, TEST_TIMER_MS: "100" },
  },
});
