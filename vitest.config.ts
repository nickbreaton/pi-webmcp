import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // `@effect/vitest` runs effects through TestContext; keep tests deterministic.
    pool: "forks",
  },
});
