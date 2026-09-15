// @ts-check
import "dotenv/config";

import node from "@astrojs/node";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";

// TEST_TIMER_MS didefinisikan saat build/dev (bukan runtime) supaya halaman
// server merender data-timer-ms yang deterministik untuk e2e. Default 30 detik.
const testTimerMs = process.env.TEST_TIMER_MS ?? "30000";

// Deteksi target deploy saat build: di Vercel (env VERCEL/VERCEL_ENV disuntik
// platform) pakai adapter Vercel; selain itu (Docker/Easypanel/VPS) pakai
// adapter Node standalone.
const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

// https://astro.build/config
export default defineConfig({
  adapter: isVercel
    ? vercel()
    : node({
        mode: "standalone",
      }),
  vite: {
    define: {
      "import.meta.env.TEST_TIMER_MS": JSON.stringify(testTimerMs),
    },
  },
});
