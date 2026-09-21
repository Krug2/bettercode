import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DiffPanel } from "./diff-panel"

describe("diff panel surfaces", () => {
  it("renders only the file list in the editor sidebar", () => {
    const html = renderToStaticMarkup(<DiffPanel open cwd="C:/repo" onClose={() => {}} onSelectDiff={() => {}} />)
    expect(html).toContain('aria-label="Filter changed files"')
    expect(html).toContain("diff-panel-files")
    expect(html).not.toContain('aria-label="Code diff"')
    expect(html).not.toContain('aria-label="Diff layout"')
    expect(html).not.toContain("diff-file-list-resizer")
    expect(html).not.toContain('aria-label="Hide file list"')
  })

  it("fixes an editor comparison to its source and file without a second file list", () => {
    const html = renderToStaticMarkup(<DiffPanel open cwd="C:/repo" onClose={() => {}} fileTarget={{ cwd: "C:/repo", path: "deleted.ts", source: "staged" }} />)
    expect(html).toContain("HEAD → Index")
    expect(html).toContain('aria-label="Code diff"')
    expect(html).toContain("No changes in this comparison")
    expect(html).not.toContain('aria-label="Change set"')
    expect(html).not.toContain('aria-label="Changed files"')
    expect(html).not.toContain('aria-label="Show file list"')
    expect(html).not.toContain("Working tree is clean")
  })

  it("keeps the full viewer available for Design and Agent modes", () => {
    const html = renderToStaticMarkup(<DiffPanel open cwd="C:/repo" onClose={() => {}} />)
    expect(html).toContain('aria-label="Change set"')
    expect(html).toContain('aria-label="Diff layout"')
    expect(html).toContain('aria-label="Code diff"')
    expect(html).not.toContain("diff-panel-files")
  })
})
