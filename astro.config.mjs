// @ts-check
import "dotenv/config";
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

// TEST_TIMER_MS didefinisikan saat build/dev (bukan runtime) supaya halaman
// server merender data-timer-ms yang deterministik untuk e2e. Default 30 detik.
const testTimerMs = process.env.TEST_TIMER_MS ?? "30000";

// https://astro.build/config
export default defineConfig({
  adapter: node({
    mode: 'standalone'
  }),
  vite: {
    define: {
      "import.meta.env.TEST_TIMER_MS": JSON.stringify(testTimerMs),
    },
  },
});
