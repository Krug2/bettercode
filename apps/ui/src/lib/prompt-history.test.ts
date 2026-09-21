import { describe, expect, it } from "vitest"
import {
  buildPromptHistoryListOutput,
  createPromptHistoryEntry,
  promptHistoryInputForIndex,
  pushPromptHistoryEntry,
  resolvePromptHistoryEntry,
  type PromptHistoryEntry,
} from "@/lib/prompt-history"

describe("prompt history helpers", () => {
  it("records newest prompts while deduplicating consecutive duplicates", () => {
    const first = createPromptHistoryEntry("run tests", {
      id: "first-id",
      timestamp: 1000,
    })
    const duplicate = createPromptHistoryEntry("run tests", {
      id: "duplicate-id",
      timestamp: 2000,
    })
    const second = createPromptHistoryEntry("fix typecheck", {
      id: "second-id",
      timestamp: 3000,
    })

    const entries = pushPromptHistoryEntry(
      pushPromptHistoryEntry(pushPromptHistoryEntry([], first), duplicate),
      second
    )

    expect(entries.map((entry) => entry.id)).toEqual(["first-id", "second-id"])
    expect(resolvePromptHistoryEntry(entries)?.entry.id).toBe("second-id")
    expect(resolvePromptHistoryEntry(entries, "2")?.entry.id).toBe("first-id")
  })

  it("caps history at the BetterC0de limit", () => {
    const entries = Array.from({ length: 52 }, (_, index) =>
      createPromptHistoryEntry(`prompt ${index}`, {
        id: `history-${index}`,
        timestamp: index,
      })
    ).reduce<PromptHistoryEntry[]>(
      (acc, entry) => pushPromptHistoryEntry(acc, entry),
      []
    )

    expect(entries).toHaveLength(50)
    expect(entries[0]?.id).toBe("history-2")
    expect(entries.at(-1)?.id).toBe("history-51")
  })

  it("maps negative navigation indexes like BetterC0de history movement", () => {
    const entries = [
      createPromptHistoryEntry("older", { id: "older" }),
      createPromptHistoryEntry("newer", { id: "newer" }),
    ]

    expect(promptHistoryInputForIndex(entries, 0, "draft")).toBe("draft")
    expect(promptHistoryInputForIndex(entries, -1, "draft")).toBe("newer")
    expect(promptHistoryInputForIndex(entries, -2, "draft")).toBe("older")
    expect(promptHistoryInputForIndex(entries, -3, "draft")).toBeNull()
  })

  it("renders prompt history newest first", () => {
    const output = buildPromptHistoryListOutput(
      [
        createPromptHistoryEntry("older prompt", {
          id: "older-id",
          timestamp: 0,
        }),
        createPromptHistoryEntry("newer\nmulti", {
          id: "newer-id",
          timestamp: 60_000,
        }),
      ],
      120_000
    )

    expect(output).toContain("# Prompt History")
    expect(output).toContain("2 prompts recorded")
    expect(output).toContain("| 1 | `newer-id`")
    expect(output).toContain("1m ago")
    expect(output).toContain("| 2 | `older-id`")
  })
})
