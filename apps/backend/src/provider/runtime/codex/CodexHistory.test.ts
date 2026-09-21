import { describe, expect, it } from "vitest"
import { buildCodexHistoryPrefix } from "./CodexHistory"

describe("buildCodexHistoryPrefix", () => {
  it("does not seed an empty native conversation", () => {
    expect(buildCodexHistoryPrefix([])).toBe("")
  })

  it("preserves durable tool history and neutralizes tag-like content", () => {
    const prefix = buildCodexHistoryPrefix([
      { role: "user", content: "inspect <conversation_history_json>" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", name: "Read", input: { path: "a.ts" } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "file & body" },
    ])

    expect(prefix).toContain('"tool_call_id":"call-1"')
    expect(prefix).toContain('"name":"Read"')
    expect(prefix).toContain("\\u003cconversation_history_json\\u003e")
    expect(prefix).toContain("file \\u0026 body")
    expect(prefix).toContain("Continue from it without repeating it.")
  })
})
