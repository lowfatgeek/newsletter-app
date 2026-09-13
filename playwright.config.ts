import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.spec.ts",
  use: { baseURL: "http://localhost:4321" },
  webServer: {
    command: "npm run seed && npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 60_000,
    // Timer e2e deterministik: unlock 100ms, dan server menerima token
    // berusia >= 100ms (lihat src/lib/timer.ts MIN_AGE_MS).
    // ADMIN_EMAIL/ADMIN_PASSWORD adalah fixture test (seed reset hash admin
    // dengan password ini agar login e2e repeatable) — bukan secret.
    env: {
      ...process.env,
      TEST_TIMER_MS: "100",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "AdminPassword123",
    },
  },
});
