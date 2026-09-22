import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // `.tsx` is included so components can be rendered in tests. This needs no
    // jsdom and no testing-library: `renderToStaticMarkup` produces HTML in
    // plain node, which is enough to assert on the things that actually
    // regressed here — theme classes, aria attributes, and whether a piece of
    // information is visible at all rather than hover-only.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    maxWorkers: 4,
    globals: true,
  },
  resolve: {
    alias: {
      // `@betterc0de/schema` resolves through npm workspaces — no explicit
      // alias needed. `@/*` stays for renderer-internal imports.
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
