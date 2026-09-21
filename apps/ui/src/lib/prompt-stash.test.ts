import { describe, expect, it } from "vitest"
import {
  buildPromptStashListOutput,
  createPromptStashEntry,
  pushPromptStashEntry,
  removePromptStashEntry,
  resolvePromptStashEntry,
} from "@/lib/prompt-stash"

describe("prompt stash helpers", () => {
  it("keeps entries oldest to newest while resolving display indexes newest first", () => {
    const first = createPromptStashEntry("first prompt", {
      id: "first-id",
      timestamp: 1000,
    })
    const second = createPromptStashEntry("second prompt", {
      id: "second-id",
      timestamp: 2000,
    })
    const entries = pushPromptStashEntry([first], second)

    expect(resolvePromptStashEntry(entries)?.entry.id).toBe("second-id")
    expect(resolvePromptStashEntry(entries, "1")?.entry.id).toBe("second-id")
    expect(resolvePromptStashEntry(entries, "2")?.entry.id).toBe("first-id")
    expect(resolvePromptStashEntry(entries, "first")?.displayIndex).toBe(2)
  })

  it("trims old entries at the BetterC0de stash cap", () => {
    const entries = Array.from({ length: 52 }, (_, index) =>
      createPromptStashEntry(`prompt ${index}`, {
        id: `stash-${index}`,
        timestamp: index,
      })
    )

    const trimmed = pushPromptStashEntry(entries.slice(0, 51), entries[51]!)

    expect(trimmed).toHaveLength(50)
    expect(trimmed[0]?.id).toBe("stash-2")
    expect(trimmed.at(-1)?.id).toBe("stash-51")
  })

  it("removes entries by original storage index", () => {
    const entries = [
      createPromptStashEntry("first", { id: "first" }),
      createPromptStashEntry("second", { id: "second" }),
    ]
    const resolved = resolvePromptStashEntry(entries, "1")

    expect(resolved?.index).toBe(1)
    expect(removePromptStashEntry(entries, resolved!.index).map((e) => e.id))
      .toEqual(["first"])
  })

  it("renders newest-first list output with age and line counts", () => {
    const output = buildPromptStashListOutput(
      [
        createPromptStashEntry("older\nmulti", {
          id: "older-id",
          timestamp: 0,
        }),
        createPromptStashEntry("newer prompt", {
          id: "newer-id",
          timestamp: 60_000,
        }),
      ],
      120_000
    )

    expect(output).toContain("# Prompt Stash")
    expect(output).toContain("2 prompts stashed")
    expect(output).toContain("newer prompt")
    expect(output).toContain("older")
    expect(output).toContain("1m ago")
    expect(output).toContain("| 2 | `older-id`")
  })
})
