import { renderToStaticMarkup } from "react-dom/server"
import { FilesIcon } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EditorFileSection } from "./editor-file-section"

afterEach(() => vi.unstubAllGlobals())

describe("collapsible editor file sections", () => {
  it("starts collapsed when nothing was toggled in this session", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} })
    const html = renderToStaticMarkup(
      <EditorFileSection
        sectionId="open-files"
        title="Open Files"
        icon={FilesIcon}
        count={3}
        modifiedCount={1}
        actions={<button>File actions</button>}
      >
        <button>Hidden file action</button>
      </EditorFileSection>
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("aria-controls=")
    expect(html).toContain('aria-label="1 unsaved files"')
    expect(html).toContain("tabular-nums")
    expect(html).toContain("File actions")
    expect(html).not.toContain("Hidden file action")
  })

  it("exposes the open state and renders the rows when opened explicitly", () => {
    const html = renderToStaticMarkup(
      <EditorFileSection
        sectionId="open-files"
        title="Open Files"
        icon={FilesIcon}
        count={3}
        defaultOpen
      >
        <button>File row</button>
      </EditorFileSection>
    )
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain("File row")
  })

  it("restores Open Files and Recent Files independently within a session", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) =>
        key.endsWith(":open-files") ? "closed" : "open",
    })
    const html = renderToStaticMarkup(
      <>
        <EditorFileSection
          sectionId="open-files"
          title="Open Files"
          icon={FilesIcon}
          count={1}
        >
          <span>Open row</span>
        </EditorFileSection>
        <EditorFileSection
          sectionId="recent-files"
          title="Recent Files"
          icon={FilesIcon}
          count={1}
        >
          <span>Recent row</span>
        </EditorFileSection>
      </>
    )
    expect(html).not.toContain("Open row")
    expect(html).toContain("Recent row")
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1)
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
  })

  it("never reads a section state persisted across app starts", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null })
    const localGetItem = vi.fn(() => "open")
    vi.stubGlobal("localStorage", { getItem: localGetItem })
    const html = renderToStaticMarkup(
      <EditorFileSection
        sectionId="recent-files"
        title="Recent Files"
        icon={FilesIcon}
        count={2}
      >
        <span>Recent row</span>
      </EditorFileSection>
    )
    expect(localGetItem).not.toHaveBeenCalled()
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("Recent row")
  })

  it("stays usable if session storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("Blocked")
      },
    })
    const html = renderToStaticMarkup(
      <EditorFileSection
        sectionId="recent-files"
        title="Recent Files"
        icon={FilesIcon}
        count={0}
      >
        <span>No files yet</span>
      </EditorFileSection>
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Recent Files"')
    expect(html).not.toContain("No files yet")
  })
})
