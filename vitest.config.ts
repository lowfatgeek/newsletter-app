import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    // reuse worker antar file (tiap file reset DB sendiri; tidak ada fake
    // timers) — menghindari 51 spawn worker, run jauh lebih cepat.
    pool: "threads",
    poolOptions: { threads: { isolate: false } },
  },
});
