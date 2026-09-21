import { useEffect, useState } from "react"
import { cjk } from "@streamdown/cjk"
import { mermaid } from "@streamdown/mermaid"

/**
 * Streamdown plugin set, with the heavy renderers loaded lazily.
 *
 * Two plugins carry libraries most sessions never need before the first frame:
 * `@streamdown/code` pulls shiki (~290 bundled TextMate grammars) and
 * `@streamdown/math` pulls katex (~250 KB). Importing either statically put all
 * of it on the launch critical path for every user, including one who never
 * opens a chat containing code or a formula.
 *
 * Loading them after mount costs nothing visible: until they resolve, code
 * fences render as plain preformatted text and formulas as their source — the
 * same progressive behaviour the code block itself already has, where raw
 * tokens show until the highlighter is ready.
 *
 * `cjk` and `mermaid` stay eager: cjk is small, and mermaid's expensive
 * dependencies (cytoscape, the diagram renderers) already resolve to their own
 * async chunks inside the plugin.
 */
const BASE_PLUGINS = { cjk, mermaid }

type StreamdownPlugins = typeof BASE_PLUGINS & {
  code?: Awaited<typeof import("@streamdown/code")>["code"]
  math?: Awaited<typeof import("@streamdown/math")>["math"]
}

/**
 * One import and one resolved object shared by every message on screen —
 * per-component imports would each allocate a new plugins object and defeat
 * the memo comparison on the message renderer.
 */
let resolvedPlugins: StreamdownPlugins = BASE_PLUGINS
let loadPromise: Promise<void> | null = null
const listeners = new Set<(plugins: StreamdownPlugins) => void>()

function loadDeferredPlugins(): void {
  if (loadPromise) return
  // `allSettled`, not `all`: a failed highlighter must not also cost the reader
  // their formulas, and vice versa. Both are enhancements over readable text.
  loadPromise = Promise.allSettled([
    import("@streamdown/code"),
    import("@streamdown/math"),
  ]).then(([codeResult, mathResult]) => {
    const next: StreamdownPlugins = { ...BASE_PLUGINS }
    if (codeResult.status === "fulfilled") next.code = codeResult.value.code
    if (mathResult.status === "fulfilled") next.math = mathResult.value.math
    resolvedPlugins = next
    for (const listener of listeners) listener(resolvedPlugins)
  })
}

export function useStreamdownPlugins(): StreamdownPlugins {
  const [plugins, setPlugins] = useState(resolvedPlugins)
  useEffect(() => {
    if (resolvedPlugins !== plugins) setPlugins(resolvedPlugins)
    listeners.add(setPlugins)
    loadDeferredPlugins()
    return () => {
      listeners.delete(setPlugins)
    }
    // Subscribing once per mount is the point; `plugins` is only read to
    // catch a load that finished between render and effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return plugins
}

/**
 * Warms the chunks once the app is idle so the plain-text phase is over before
 * a transcript is on screen.
 */
export function prefetchStreamdownCodePlugin(): void {
  loadDeferredPlugins()
}
