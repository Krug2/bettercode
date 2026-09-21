import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { fileURLToPath } from "node:url"

describe("app-shell orchestrator streaming subscriptions", () => {
  it("does not subscribe to streaming text at the shell orchestrator", () => {
    const sourcePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "use-app-shell-bundles.tsx"
    )
    const source = fs.readFileSync(sourcePath, "utf8")
    expect(source).not.toMatch(/useChatStreamingState\s*\(/)
    expect(source).not.toMatch(/streamingText\s*,/)
    expect(source).not.toMatch(/streamingText:/)
  })
})
