import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ModelSwitchNotice } from "@/components/chat/chat-transcript"

/**
 * The divider announces which model takes over for the next turn, so it shows
 * that model's mark. It used to render a generic cube for every provider,
 * which told the reader nothing the sentence did not already say.
 */

function render(from: string, to: string): string {
  return renderToStaticMarkup(<ModelSwitchNotice from={from} to={to} />)
}

describe("ModelSwitchNotice", () => {
  it("names both models by their display name, not their id", () => {
    const html = render("claude-opus-5", "grok-4.6")
    expect(html).toContain("Opus 5")
    expect(html).toContain("Grok 4.6")
    expect(html).not.toContain("claude-opus-5")
  })

  it("shows the mark of the model taking over, not the one being left", () => {
    const html = render("claude-opus-5", "grok-4.6")
    expect(html).toContain("grok.svg")
    expect(html).not.toContain("claude.svg")
  })

  it("inverts a monochrome mark so it survives a dark background", () => {
    expect(render("claude-opus-5", "grok-4.6")).toContain("dark:invert")
  })

  it("leaves a coloured mark alone", () => {
    const html = render("grok-4.6", "claude-opus-5")
    expect(html).toContain("claude.svg")
    expect(html).not.toContain("dark:invert")
  })

  it("falls back to the generic icon for a model it does not know", () => {
    // `getModelInfo` reports an unknown id as `{ name: id, logo: "" }`, so the
    // empty logo has to be treated as "no mark" rather than rendered as an
    // <img> with an empty src.
    const html = render("claude-opus-5", "grok-build-0.1")
    expect(html).toContain("grok-build-0.1")
    expect(html).not.toContain("<img")
    expect(html).toContain("<svg")
  })
})
