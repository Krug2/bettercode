import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DiffCodeText, DiffHunkLines } from "./diff-code"
import { parseGitDiff } from "@/lib/git-diff"
import { highlightDiff } from "@/lib/diff-syntax"

const file = parseGitDiff(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,2 +1,3 @@
-const message = "Old";
+const message = "A much longer message that wraps across several lines";
+const extra = true;
 console.log(message);
`)[0]!

describe("diff code rendering", () => {
  it("pairs both revisions in a shared row so wrapped lines cannot drift", () => {
    const html = renderToStaticMarkup(
      <DiffHunkLines hunk={file.hunks[0]!} mode="split" wrap />
    )
    expect(html.match(/class="diff-code-pair"/g)).toHaveLength(3)
    expect(html.match(/data-side="old"/g)).toHaveLength(3)
    expect(html.match(/data-side="new"/g)).toHaveLength(3)
    expect(html).toContain('data-kind="empty" data-side="old"')
    expect(html).not.toContain('data-kind="header"')
    expect(html).toContain('data-wrap="true"')
  })

  it("shows unified revisions, line numbers and inline change marks", () => {
    const html = renderToStaticMarkup(
      <DiffHunkLines hunk={file.hunks[0]!} mode="unified" wrap={false} />
    )
    expect(html.match(/data-side="unified"/g)).toHaveLength(4)
    expect(html).not.toContain('class="diff-code-pair"')
    expect(html).toContain('data-wrap="false"')
    expect(html).toContain('class="diff-word-change">Old</mark>')
    expect(html).toContain(
      'class="diff-line-number" aria-hidden="true">3</span>'
    )
  })

  it("renders real syntax tokens in both themes while retaining selectable source text", async () => {
    const syntax = await highlightDiff(file)
    const html = renderToStaticMarkup(
      <DiffHunkLines hunk={file.hunks[0]!} mode="split" wrap syntax={syntax} />
    )
    expect(html).toContain("--diff-token-light:#0000FF")
    expect(html).toContain("--diff-token-dark:#569CD6")
    expect(html).not.toContain(
      '--diff-token-light:inherit;--diff-token-dark:inherit">const'
    )
    expect(html).toContain('class="diff-code-text"')
  })

  it("escapes HTML source instead of rendering active elements", () => {
    const content = '<img src="x" onerror="alert(1)">'
    const html = renderToStaticMarkup(
      <DiffCodeText content={content} changed={{ start: 1, end: 4 }} />
    )
    expect(html).not.toContain("<img")
    expect(html).toContain('&lt;<mark class="diff-word-change">img</mark>')
  })
})
