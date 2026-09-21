import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ChatFileChanges } from "./chat-file-changes"
import type { FileDiff } from "@/components/ai-elements/file-changes-bar"

const file = (path: string): FileDiff => ({ path, additions: 2, deletions: 1, oldText: "old", newText: "new", isNew: false })

describe("chat file changes", () => {
  it("keeps large snapshots compact and does not mount collapsed runtime files or diff contents", () => {
    const diffs = [
      ...Array.from({ length: 1000 }, (_, i) => file(`.tmp-shots/profile/Default/Extensions/${i}/messages.json`)),
      ...Array.from({ length: 12 }, (_, i) => file(`src/feature-${i}.tsx`)),
    ]
    const html = renderToStaticMarkup(<ChatFileChanges diffs={diffs} />)
    expect(html).toContain("12 project files")
    expect(html).toContain("Temporary &amp; generated")
    expect(html).toContain('aria-expanded="false"')
    expect(html.match(/data-file-change=/g)).toHaveLength(5)
    expect(html).not.toContain("messages.json")
    expect(html).not.toContain("feature-5.tsx")
    expect(html).toContain("+24")
    expect(html).not.toContain("+2024")
    expect(html).toContain("Show 7 more")
    expect(html).toContain("not-prose")
    expect(diffs).toHaveLength(1012)
  })

  it("keeps a collapsed entry when only generated files changed", () => {
    const html = renderToStaticMarkup(<ChatFileChanges diffs={[file(".tmp-server.log")]} />)
    expect(html).toContain("0 project files")
    expect(html).toContain("Temporary &amp; generated")
    expect(html).not.toContain("data-file-change=")
  })

  it("renders nothing for an empty list and merges repeated file edits without mutating input", () => {
    expect(renderToStaticMarkup(<ChatFileChanges diffs={[]} />)).toBe("")
    const diffs = [file("src/hero.tsx"), file("src/hero.tsx")]
    const html = renderToStaticMarkup(<ChatFileChanges diffs={diffs} />)
    expect(html).toContain("1 project file")
    expect(html.match(/data-file-change=/g)).toHaveLength(1)
    expect(html).toContain("+4")
    expect(diffs[0].additions).toBe(2)
  })
})
