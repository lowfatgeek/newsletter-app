import { defineConfig } from "@playwright/test";
import { E2E_CRON_SECRET, E2E_EMAILIT_WEBHOOK_SECRET } from "./test/broadcast/e2e/constants";

export default defineConfig({
  testDir: "test",
  testMatch: "**/*.spec.ts",
  // Satu worker: e2e berbagi state DB global (audiens broadcast, outbox OTP —
  // login paralel bisa saling membaca OTP dari email_outbox).
  workers: 1,
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
    // CRON_SECRET/EMAILIT_WEBHOOK_SECRET/MO_BROADCAST dipakai jalur broadcast:
    // MO_BROADCAST=true membuat worker melewati API provider (fake message id
    // mo-<recipientId>); secret-nya diimpor dari constants e2e agar spec dan
    // server selalu sinkron.
    env: {
      ...process.env,
      ASTRO_DEV_BACKGROUND: "false",
      TEST_TIMER_MS: "100",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? "kelaswfa@gmail.com",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "AdminPassword123",
      MO_BROADCAST: "true",
      CRON_SECRET: E2E_CRON_SECRET,
      EMAILIT_WEBHOOK_SECRET: E2E_EMAILIT_WEBHOOK_SECRET,
    },
  },
});
