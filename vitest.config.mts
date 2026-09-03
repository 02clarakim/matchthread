import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    // Integration/API tests share one local Postgres/Redis instance (no
    // isolated test DB — see tests/integration/event-ingestion.test.ts).
    // Running test files in parallel caused real connection-pool races
    // that intermittently broke an afterAll cleanup mid-way, leaking
    // fixture rows into the dev database. Serial execution trades a
    // little speed for eliminating that whole class of flake.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
