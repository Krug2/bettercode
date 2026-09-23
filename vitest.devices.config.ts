import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/remote-protocol/src/**/*.test.ts", "apps/relay/src/**/*.test.ts", "tests/remote-desktop/**/*.test.ts"],
    environment: "node", pool: "forks", maxWorkers: 2, testTimeout: 30_000, hookTimeout: 30_000,
  },
})
