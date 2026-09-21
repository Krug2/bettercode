import { describe, expect, it } from "vitest"
import { changedProviderConfigFields, isValidEnvironmentDraft, normalizeProviderInstanceConfig } from "./provider-instance-settings"

describe("provider instance settings round trips", () => {
  it("does not turn a blur on an empty field into a credential destination change", () => {
    expect(changedProviderConfigFields({}, { binaryPath: "", apiEndpoint: "" })).toEqual({})
    expect(changedProviderConfigFields({ binaryPath: "claude" }, { binaryPath: "claude" })).toEqual({})
    expect(changedProviderConfigFields({ binaryPath: "claude" }, { binaryPath: "" })).toEqual({ binaryPath: "" })
  })
  it.each(["grok-cli", "claude-terminal", "custom-adapter"])("preserves %s and credential metadata without adding destination fields", (driver) => {
    const raw = {
      instanceId: "my-provider", driver, enabled: false,
      config: { apiEndpoint: "https://provider.example", apiKey: { configured: true, storage: "encrypted" } },
      environment: [{ name: "TOKEN", value: "", sensitive: true, valueRedacted: true, secretState: { configured: true, storage: "encrypted" as const } }],
    }
    const normalized = normalizeProviderInstanceConfig(raw.instanceId, raw)
    expect(normalized).toEqual(raw)
    expect(normalized.config).not.toHaveProperty("binaryPath")
    expect(normalized.config).not.toHaveProperty("serverPassword")
    expect(raw.environment[0]?.secretState).toEqual(normalized.environment[0]?.secretState)
  })

  it("keeps incomplete environment rows local until their names are valid", () => {
    expect(isValidEnvironmentDraft([{ name: "", value: "", sensitive: false }])).toBe(false)
    expect(isValidEnvironmentDraft([{ name: "TOKEN", value: "", sensitive: true }])).toBe(true)
    expect(isValidEnvironmentDraft([{ name: "bad name", value: "x", sensitive: false }])).toBe(false)
    expect(isValidEnvironmentDraft([])).toBe(true)
  })
})
