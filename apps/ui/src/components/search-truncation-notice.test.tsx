import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SearchTruncationNotice } from "@/components/search-truncation-notice"

describe("SearchTruncationNotice", () => {
  // The whole point of the component: a consumer mounts it unconditionally
  // and the flag decides. A complete result must leave no trace in the DOM —
  // not an empty row, not a hidden node, nothing for a screen reader.
  it("renders nothing at all when the search was complete", () => {
    expect(
      renderToStaticMarkup(
        <SearchTruncationNotice truncated={false} reason="deadline" />
      )
    ).toBe("")
    expect(
      renderToStaticMarkup(<SearchTruncationNotice truncated={false} />)
    ).toBe("")
  })

  it("renders a labelled note with the reason when the search was cut short", () => {
    const html = renderToStaticMarkup(
      <SearchTruncationNotice truncated reason="deadline" />
    )
    expect(html).toContain('role="note"')
    expect(html).toContain('data-search-truncated="deadline"')
    expect(html).toContain(
      "Results cut short (time limit) — narrow your search"
    )
    // The icon is decorative; the sentence carries the meaning.
    expect(html).toContain('aria-hidden="true"')
  })

  it("marks an unknown reason instead of pretending to know it", () => {
    const html = renderToStaticMarkup(<SearchTruncationNotice truncated />)
    expect(html).toContain('data-search-truncated="unknown"')
    expect(html).toContain("Results cut short (cap)")
  })

  it("takes the surface's own subject and hint", () => {
    const html = renderToStaticMarkup(
      <SearchTruncationNotice
        truncated
        reason="visited"
        subject="File list"
        hint="some files may be missing"
        className="px-3"
      />
    )
    expect(html).toContain(
      "File list cut short (entry cap) — some files may be missing"
    )
    expect(html).toContain("px-3")
  })

  // This app is open all day on high-refresh displays: the indicator has to
  // be static. A pulse or spin here would peg the GPU for a footnote.
  it("does not animate", () => {
    const html = renderToStaticMarkup(
      <SearchTruncationNotice truncated reason="deadline" />
    )
    expect(html).not.toMatch(/animate-/)
    expect(html).not.toMatch(/transition/)
  })
})
