import { describe, expect, it } from "vitest"
import {
  dispatchSlashCommand,
  indexSlashCommands,
} from "./slash-registry"

describe("slash command registry dispatch", () => {
  it("resolves aliases through the registry instead of a sequential callback ladder", () => {
    const index = indexSlashCommands([
      {
        names: ["help", "help.show"],
        run: () => "# Help",
      },
      {
        names: ["diff", "session.diff"],
        run: (context: { thread: string }) => `# Diff ${context.thread}`,
      },
    ])

    expect(dispatchSlashCommand("/help", { thread: "a" }, index)).toBe("# Help")
    expect(dispatchSlashCommand("/help.show", { thread: "a" }, index)).toBe(
      "# Help"
    )
    expect(dispatchSlashCommand("/session.diff", { thread: "t1" }, index)).toBe(
      "# Diff t1"
    )
    expect(dispatchSlashCommand("/unknown", { thread: "a" }, index)).toBeUndefined()
  })
})
