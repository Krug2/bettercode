import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Mermaid source is model output and the rendered SVG reaches the DOM through
 * `dangerouslySetInnerHTML`, so `sanitizeSvg` is the one place where
 * model-controlled markup is injected directly.
 *
 * This asserts the sanitizer's *configuration* rather than its output: the UI
 * suite runs in the `node` environment (see apps/ui/vitest.config.ts) and
 * DOMPurify needs a DOM, so a behavioural test would require adding a jsdom
 * dependency. The configuration is the thing that regressed before — `<style>`
 * was re-enabled via ADD_TAGS on the strength of an incorrect comment about
 * DOMPurify parsing CSS — so it is the thing worth pinning. If a DOM
 * environment is ever added, replace this with real round-trip assertions.
 */
describe("sanitizeSvg configuration", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "./sanitize.ts"),
    "utf8"
  )

  // A <style> element inside inline SVG applies to the whole host document,
  // not just the diagram — model CSS could hide or reposition the
  // tool-approval dialog and its Approve/Deny buttons.
  it("never re-enables <style> as an allowed tag", () => {
    expect(source).not.toMatch(/ADD_TAGS\s*:\s*\[[^\]]*["']style["']/)
  })

  it("explicitly forbids style, script, and foreignObject", () => {
    const forbid = source.match(/FORBID_TAGS\s*:\s*\[([^\]]*)\]/)
    expect(forbid, "FORBID_TAGS must be declared").not.toBeNull()
    for (const tag of ["style", "script", "foreignObject"]) {
      expect(forbid?.[1]).toContain(tag)
    }
  })

  it("keeps the svg profile rather than sanitizing as HTML", () => {
    expect(source).toContain("USE_PROFILES")
    expect(source).toMatch(/svg\s*:\s*true/)
  })

  it("routes sanitization through DOMPurify, not a hand-rolled regex", () => {
    expect(source).toContain("DOMPurify.sanitize")
  })
})
