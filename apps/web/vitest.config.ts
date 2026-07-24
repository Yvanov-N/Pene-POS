import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests only, deliberately -- no mocking of Supabase or Dexie.
// Runs against the real local `pene-pos-dev` Postgres via the Supabase CLI
// stack (`supabase start` first) and real IndexedDB (via fake-indexeddb,
// since Vitest's default node environment has no browser IndexedDB). See
// src/services/sync/__tests__/testHelpers.ts for the local-stack client.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/services/sync/__tests__/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // These are integration tests sharing one real local Postgres instance
    // (and, for stock-race/idempotency, the SAME seeded rows) -- running
    // test FILES in parallel (Vitest's default) risks one file's assertions
    // observing another file's concurrent mutation of the same shared seed
    // row. Sequential file execution trades some wall-clock time for
    // determinism, the right call for a suite this size against a shared
    // external resource.
    fileParallelism: false,
  },
});
