import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    // Vitest 5: `isolate` adalah opsi top-level (poolOptions sudah tidak ada).
    // Reuse worker antar file — tiap file reset DB sendiri & tidak ada fake
    // timers, jadi isolasi per-file tidak diperlukan.
    isolate: false,
  },
});
