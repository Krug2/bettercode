import { describe, expect, it } from "vitest"
import type { CodeOutlineItem } from "@/lib/code-outline"
import { filterDocumentSymbols } from "@/lib/document-symbols"

function symbol(
  name: string,
  kind: CodeOutlineItem["kind"],
  line: number,
  detail?: string
): CodeOutlineItem {
  return {
    id: `${line}:${name}`,
    name,
    kind,
    line,
    column: 1,
    depth: 0,
    ...(detail ? { detail } : {}),
  }
}

describe("filterDocumentSymbols", () => {
  const outline = [
    symbol(
      "useProviderRuntime",
      "function",
      24,
      "function useProviderRuntime()"
    ),
    symbol("ProviderRuntimePanel", "component", 5),
    symbol("RuntimeConfig", "interface", 18),
    symbol("applyModelSelection", "method", 42),
  ]

  it("keeps source order for an empty query", () => {
    expect(
      filterDocumentSymbols(outline, "", 2).map((item) => item.name)
    ).toEqual(["useProviderRuntime", "ProviderRuntimePanel"])
  })

  it("prioritizes exact and prefix matches over detail matches", () => {
    expect(
      filterDocumentSymbols(outline, "provider").map((item) => item.name)
    ).toEqual(["ProviderRuntimePanel", "useProviderRuntime"])
  })

  it("matches kind and multi-token detail queries", () => {
    expect(filterDocumentSymbols(outline, "function runtime")).toEqual([
      outline[0],
    ])
    expect(
      filterDocumentSymbols(outline, "interface").map((item) => item.name)
    ).toEqual(["RuntimeConfig"])
  })
})
