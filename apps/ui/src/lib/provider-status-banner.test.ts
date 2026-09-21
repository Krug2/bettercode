import { describe, expect, it } from "vitest"
import { getProviderStatusBannerView } from "@/lib/provider-status-banner"

describe("getProviderStatusBannerView", () => {
  it("hides ready, disabled, and unknown providers", () => {
    expect(getProviderStatusBannerView(null)).toBeNull()
    expect(getProviderStatusBannerView({ name: "Codex" })).toBeNull()
    expect(
      getProviderStatusBannerView({ name: "Codex", status: "ready" })
    ).toBeNull()
    expect(
      getProviderStatusBannerView({ name: "Codex", status: "disabled" })
    ).toBeNull()
  })

  it("treats configured false as a warning with setup copy", () => {
    expect(
      getProviderStatusBannerView({
        name: "Claude",
        configured: false,
        setupHint: "Run claude login.",
      })
    ).toEqual({
      tone: "warning",
      status: "warning",
      providerLabel: "Claude",
      title: "Claude provider status",
      message: "Run claude login.",
    })
  })

  it("uses runtime status messages before fallback copy", () => {
    expect(
      getProviderStatusBannerView({
        name: "Codex",
        status: "error",
        statusMessage: "Codex CLI executable was not found.",
      })
    ).toMatchObject({
      tone: "error",
      message: "Codex CLI executable was not found.",
    })
  })

  it("falls back to provider labels and default messages", () => {
    expect(
      getProviderStatusBannerView({
        providerKind: "claude",
        providerInstanceId: "claude-max",
        status: "error",
      })
    ).toEqual({
      tone: "error",
      status: "error",
      providerLabel: "Claude CLI / claude-max",
      title: "Claude CLI / claude-max provider status",
      message: "Claude CLI / claude-max provider is unavailable.",
    })
  })
})
