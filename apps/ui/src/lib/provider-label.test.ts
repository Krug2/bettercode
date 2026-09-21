import { describe, expect, it } from "vitest"
import { formatProviderActivityLabel } from "@/lib/provider-label"

describe("formatProviderActivityLabel", () => {
  it("formats builtin CLI providers", () => {
    expect(formatProviderActivityLabel({ providerKind: "codex" })).toBe(
      "Codex CLI"
    )
    expect(formatProviderActivityLabel({ providerKind: "claude" })).toBe(
      "Claude CLI"
    )
    expect(formatProviderActivityLabel({ providerKind: "anthropic_cli" })).toBe(
      "Claude CLI"
    )
    expect(formatProviderActivityLabel({ providerKind: "cursor" })).toBe(
      "Cursor"
    )
    expect(formatProviderActivityLabel({ providerKind: "betterc0de" })).toBe(
      "BetterC0de"
    )
  })

  it("keeps custom provider instances visible beside the provider family", () => {
    expect(
      formatProviderActivityLabel({
        providerKind: "codex",
        providerInstanceId: "codex-work",
      })
    ).toBe("Codex CLI / codex-work")
    expect(
      formatProviderActivityLabel({
        providerKind: "claude",
        providerInstanceId: "claude-max",
      })
    ).toBe("Claude CLI / claude-max")
    expect(
      formatProviderActivityLabel({
        providerKind: "claude",
        providerInstanceId: "claude-terminal",
      })
    ).toBe("Claude CLI / claude-terminal")
  })

  it("infers the provider family from an instance id when needed", () => {
    expect(
      formatProviderActivityLabel({ providerInstanceId: "codex-main" })
    ).toBe("Codex CLI / codex-main")
    expect(
      formatProviderActivityLabel({ providerInstanceId: "claude-main" })
    ).toBe("Claude CLI / claude-main")
    expect(
      formatProviderActivityLabel({ providerInstanceId: "claude-pty" })
    ).toBe("Claude CLI / claude-pty")
    expect(
      formatProviderActivityLabel({ providerInstanceId: "cursor-main" })
    ).toBe("Cursor / cursor-main")
    expect(
      formatProviderActivityLabel({ providerInstanceId: "betterc0de-main" })
    ).toBe("BetterC0de / betterc0de-main")
  })
})
