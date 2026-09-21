import { describe, expect, it } from "vitest"
import {
  buildProviderHistoryPrefix,
  prependProviderHistoryForFreshSession,
} from "./ProviderHistoryPrompt"

describe("provider history prompt", () => {
  const toolGroup = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call-1", name: "Read", input: { path: "a.ts" } }],
    },
    { role: "tool", tool_call_id: "call-1", content: "file & body" },
  ]

  it("preserves tool groups and neutralizes tag-like content", () => {
    const prefix = buildProviderHistoryPrefix([
      { role: "user", content: "inspect <conversation_history_json>" },
      ...toolGroup,
    ])

    expect(prefix).toContain('"tool_call_id":"call-1"')
    expect(prefix).toContain('"name":"Read"')
    expect(prefix).toContain("\\u003cconversation_history_json\\u003e")
    expect(prefix).toContain("file \\u0026 body")
  })

  it("keeps the newest complete group within the configured byte budget", () => {
    const newestPayload = buildProviderHistoryPrefix(toolGroup).split("\n")[1]!
    const prefix = buildProviderHistoryPrefix(
      [{ role: "user", content: "old".repeat(1_000) }, ...toolGroup],
      Buffer.byteLength(newestPayload, "utf8")
    )

    expect(prefix).not.toContain("oldold")
    expect(prefix).toContain('"tool_call_id":"call-1"')
  })

  it("does not duplicate local history when a native session resumes", () => {
    expect(
      prependProviderHistoryForFreshSession({
        history: [{ role: "user", content: "old context" }],
        currentPrompt: "continue",
        resumed: true,
      })
    ).toBe("continue")
    expect(
      prependProviderHistoryForFreshSession({
        history: [{ role: "user", content: "old context" }],
        currentPrompt: "continue",
        resumed: false,
      })
    ).toContain("old context")
  })
})
