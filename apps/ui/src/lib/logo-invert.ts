import { builtinProviders } from "@/lib/builtin-providers"

/**
 * Whether a provider logo has to be inverted to stay visible on a dark
 * background.
 *
 * Logos render through `<img src>`, which loads the SVG as its own isolated
 * document. A `currentColor` fill there cannot inherit the page's text colour —
 * it resolves to black. So a black-on-transparent mark needs `dark:invert` or
 * it disappears against a dark surface.
 *
 * Several call sites used to hardcode `logo.includes("openai")`, which was true
 * of the only monochrome logo at the time and silently wrong the moment a
 * second one arrived: the Grok mark rendered black on black. The answer belongs
 * with the provider data, so this reads the `invertDark` flag those providers
 * already carry.
 *
 * Matching is by file name rather than full URL because callers hold logo
 * strings that went through `assetUrl()` at different times and may carry a
 * different base or a cache-busting query.
 */

function logoFileName(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? ""
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1).toLowerCase()
}

const INVERTING_LOGO_FILES: ReadonlySet<string> = new Set(
  builtinProviders
    .filter((provider) => provider.invertDark && provider.logo)
    .map((provider) => logoFileName(provider.logo))
)

/**
 * Defaults to `false` for anything unknown — a plugin icon we have never seen
 * is far more likely to carry its own colours than to be a black glyph, and
 * inverting a colourful icon is the more visible mistake.
 */
export function logoNeedsDarkInvert(logo: string | null | undefined): boolean {
  if (!logo) return false
  return INVERTING_LOGO_FILES.has(logoFileName(logo))
}
