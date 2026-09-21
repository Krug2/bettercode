import { describe, expect, it } from "vitest"
import { logoNeedsDarkInvert } from "@/lib/logo-invert"
import { builtinProviders } from "@/lib/builtin-providers"

function logoFor(providerId: string): string {
  const provider = builtinProviders.find((entry) => entry.id === providerId)
  if (!provider) throw new Error(`no builtin provider ${providerId}`)
  return provider.logo
}

describe("logoNeedsDarkInvert", () => {
  it("inverts the monochrome marks", () => {
    // Both render as a black glyph on transparent, so on a dark surface they
    // are invisible without this.
    for (const id of ["grok", "grok-cli", "codex", "openai-api"]) {
      expect(logoNeedsDarkInvert(logoFor(id)), id).toBe(true)
    }
  })

  it("leaves logos that carry their own colours alone", () => {
    for (const id of ["claude", "or-qwen", "or-deepseek"]) {
      expect(logoNeedsDarkInvert(logoFor(id)), id).toBe(false)
    }
  })

  it("ignores a different base path or a cache-busting query", () => {
    const grok = logoFor("grok")
    const file = grok.slice(grok.lastIndexOf("/") + 1)
    expect(logoNeedsDarkInvert(`/some/other/base/${file}`)).toBe(true)
    expect(logoNeedsDarkInvert(`${grok}?v=3`)).toBe(true)
    expect(logoNeedsDarkInvert(`${grok}#frag`)).toBe(true)
  })

  it("does not invert an unknown icon", () => {
    // A plugin icon we have never seen is far likelier to be colourful, and
    // inverting a colourful icon is the more visible mistake.
    expect(logoNeedsDarkInvert("/icons/plugins/some-plugin.png")).toBe(false)
  })

  it("treats a missing logo as nothing to invert", () => {
    expect(logoNeedsDarkInvert("")).toBe(false)
    expect(logoNeedsDarkInvert(null)).toBe(false)
    expect(logoNeedsDarkInvert(undefined)).toBe(false)
  })

  it("never disagrees with the provider data it is derived from", () => {
    // The bug this replaced was a hardcoded `logo.includes("openai")`, which
    // was accidentally right for one provider and wrong for every one added
    // after it. Keep the function and the data in lockstep.
    for (const provider of builtinProviders) {
      if (!provider.logo) continue
      expect(logoNeedsDarkInvert(provider.logo), provider.id).toBe(
        Boolean(provider.invertDark)
      )
    }
  })
})
