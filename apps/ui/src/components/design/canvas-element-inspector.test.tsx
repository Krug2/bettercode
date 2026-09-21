import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
  EMPTY_INSPECTOR_STATE,
  withSelectedElement,
  type ElementInspectorState,
} from "@/components/browser-preview/inspector-state"
import type { SelectedElement } from "@/components/browser-preview/types"
import { CanvasElementInspector } from "./canvas-element-inspector"

// Static rendering reads a store's *initial* snapshot, so the stores are
// mocked as selectors over a fixture, like the other canvas tests do. The
// store's own transitions are covered in canvas-preview-store.test.ts.
const fixture = vi.hoisted(() => ({
  threads: [{ id: "a", projectName: "Shop" }, { id: "b", projectName: "Dashboard" }],
  focus: null as null | { key: string; threadId: string; deviceId: string; pageUrl: string },
  inspector: null as unknown as ElementInspectorState,
  setTab: vi.fn(),
  selectFromTree: vi.fn(),
  highlight: vi.fn(),
  clearSelection: vi.fn(),
  applyStyle: vi.fn(),
}))
vi.mock("@/lib/chat-store", () => ({
  useChatStore: (select: (state: typeof fixture) => unknown) => select(fixture),
}))
vi.mock("./canvas-preview-store", () => ({
  useCanvasPreviewStore: (select: (state: typeof fixture) => unknown) => select(fixture),
}))

const element: SelectedElement = {
  selector: "#buy", tagName: "button", id: "buy", className: "cta", text: "Buy",
  childCount: 0, styles: { color: "black" }, rect: { x: 0, y: 0, w: 60, h: 24 },
}

describe("CanvasElementInspector", () => {
  beforeEach(() => {
    fixture.focus = null
    fixture.inspector = EMPTY_INSPECTOR_STATE
  })

  it("is the editor's inspector, waiting for a pick", () => {
    const html = renderToStaticMarkup(<CanvasElementInspector />)
    expect(html).toContain('aria-label="Element inspector"')
    expect(html).toContain("Pick an element in a preview to inspect it")
    expect(html).toContain("Open a page to explore its elements")
    expect(html).not.toContain("data-canvas-inspector-focus")
  })

  it("names the inspected preview and shows the picked element's styles", () => {
    fixture.focus = {
      key: "b::tablet", threadId: "b", deviceId: "tablet", pageUrl: "http://localhost:3001/",
    }
    fixture.inspector = withSelectedElement(EMPTY_INSPECTOR_STATE, element)
    const html = renderToStaticMarkup(<CanvasElementInspector />)
    expect(html).toContain('data-canvas-inspector-focus="b::tablet"')
    expect(html).toContain("Dashboard · Tablet")
    expect(html).toContain("#buy")
    expect(html).toMatch(/id="[^"]*-styles"[^>]*aria-selected="true"/)
    expect(html).not.toContain("Pick an element in a preview")
  })
})
