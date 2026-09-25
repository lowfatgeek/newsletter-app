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
  site: process.env.PUBLIC_SITE_URL || "https://kado.kelaswfa.my.id",
  security: {
    // Nonaktifkan checkOrigin bawaan Astro karena aplikasi berjalan di balik
    // reverse-proxy (Docker/Easypanel/Traefik) yang memicu false-positive 403
    // ("Cross-site POST form submissions are forbidden"). Validasi Origin sudah
    // ditangani secara aman dan proxy-aware oleh verifyAdminOrigin() di guard.ts.
    checkOrigin: false,
  },
  adapter: isVercel
    ? vercel()
    : node({
        mode: "standalone",
      }),
  vite: {
    define: {
      "import.meta.env.TEST_TIMER_MS": JSON.stringify(testTimerMs),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Pisahkan modul src/lib/notfound ke chunk tersendiri agar Rollup
            // tidak menggabungkannya dengan komponen reward (RewardClaimModal,
            // LocaleSwitch, EmailForm) di halaman SSR r/[slug], yang sebelumnya
            // menyebabkan artefak penamaan CSS chunk menjadi `notfound.*.css`.
            if (id.includes("lib/notfound") || id.includes("lib\\notfound")) {
              return "notfound-page";
            }
          },
        },
      },
    },
  },
});
