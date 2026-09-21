import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ProviderIcon } from "@/components/provider-icon"
import { builtinProviders } from "@/lib/builtin-providers"
import type { UiProvider } from "@/lib/provider-types"

function render(provider: UiProvider): string {
  return renderToStaticMarkup(<ProviderIcon provider={provider} />)
}

function providerById(id: string): UiProvider {
  const provider = builtinProviders.find((entry) => entry.id === id)
  if (!provider) throw new Error(`no builtin provider ${id}`)
  return provider
}

function base(overrides: Partial<UiProvider>): UiProvider {
  return {
    id: "test",
    name: "Test",
    logo: "",
    models: [],
    ...overrides,
  } as UiProvider
}

describe("ProviderIcon", () => {
  it("renders the provider logo with the name as alt text", () => {
    const html = render(base({ name: "Grok CLI", logo: "/icons/grok.svg" }))
    expect(html).toContain('src="/icons/grok.svg"')
    expect(html).toContain('alt="Grok CLI"')
  })

  it("falls back to a generic icon when there is no logo", () => {
    const html = render(base({ logo: "" }))
    expect(html).toContain("<svg")
    expect(html).not.toContain("<img")
  })

  /**
   * The regression this file exists for. Logos are loaded through an `<img>`,
   * and an SVG loaded that way is an isolated document — a `currentColor` fill
   * cannot inherit the page's text colour and resolves to black. A
   * black-on-transparent glyph therefore NEEDS `dark:invert` to stay visible
   * on a dark background. Removing it once made the Grok logo black on black.
   */
  it("inverts a monochrome glyph for dark mode when asked", () => {
    const html = render(
      base({ logo: "/icons/grok.svg", invertDark: true } as Partial<UiProvider>)
    )
    expect(html).toContain("dark:invert")
  })

  it("does not invert a logo that carries its own colours", () => {
    const html = render(base({ logo: "/icons/openai.svg" }))
    expect(html).not.toContain("dark:invert")
  })

  it("keeps the Grok providers on a theme-safe logo", () => {
    for (const id of ["grok-cli", "grok"]) {
      const provider = providerById(id)
      // Not the X/Twitter mark, and not xAI's company slash.
      expect(provider.logo, id).toContain("grok.svg")
      // Black-on-transparent, so it must be inverted for dark mode.
      expect(
        (provider as { invertDark?: boolean }).invertDark,
        `${id} needs invertDark for its monochrome glyph`
      ).toBe(true)
      expect(render(provider), id).toContain("dark:invert")
    }
  })
})
