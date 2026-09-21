import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PreviewViewportHandle } from "@/components/browser-preview/preview-viewport"
import type { DomNode, SelectedElement } from "@/components/browser-preview/types"
import {
  canvasViewportKey,
  registerCanvasViewport,
  useCanvasPreviewStore,
} from "./canvas-preview-store"

const tree = (tag: string): DomNode => ({
  tag, id: "", classes: [], selector: tag, text: "", children: [],
})
const element: SelectedElement = {
  selector: "#buy", tagName: "button", id: "buy", className: "", text: "Buy",
  childCount: 0, styles: { color: "black" }, rect: { x: 0, y: 0, w: 1, h: 1 },
}
function viewport(): PreviewViewportHandle & { posted: unknown[] } {
  const posted: unknown[] = []
  return {
    posted,
    reload: vi.fn(), highlight: vi.fn(), openDevTools: vi.fn(),
    goBackInPage: vi.fn(), goForwardInPage: vi.fn(),
    pageZoomIn: vi.fn(), pageZoomOut: vi.fn(), pageZoomReset: vi.fn(),
    executeJavaScript: vi.fn(async () => undefined),
    getWebContentsId: () => null,
    postToPreview: (msg) => { posted.push(msg) },
  }
}

const initial = useCanvasPreviewStore.getState()
beforeEach(() => useCanvasPreviewStore.setState(initial, true))
afterEach(() => {
  registerCanvasViewport(canvasViewportKey("a", "desktop"), null)
  registerCanvasViewport(canvasViewportKey("b", "tablet"), null)
})

describe("canvas preview store", () => {
  it("follows the preview the user picked in and routes edits to that page", () => {
    const store = useCanvasPreviewStore.getState()
    const desktop = viewport()
    const tablet = viewport()
    registerCanvasViewport(canvasViewportKey("a", "desktop"), desktop)
    registerCanvasViewport(canvasViewportKey("b", "tablet"), tablet)
    store.reportDomTree("a", "desktop", tree("main"))
    store.reportDomTree("b", "tablet", tree("nav"))

    store.reportElement("b", "tablet", "http://localhost:3001/", element)
    const state = useCanvasPreviewStore.getState()
    expect(state.focus).toEqual({
      key: "b::tablet", threadId: "b", deviceId: "tablet", pageUrl: "http://localhost:3001/",
    })
    expect(state.inspector.tree?.tag).toBe("nav")
    expect(state.inspector.selected).toBe(element)
    expect(state.inspector.tab).toBe("styles")

    state.applyStyle("color", "red")
    state.highlight("#buy")
    state.selectFromTree("#other")
    expect(tablet.posted).toEqual([
      { type: "bc-apply-style", selector: "#buy", property: "color", value: "red" },
      { type: "bc-highlight", selector: "#buy" },
      { type: "bc-select", selector: "#other" },
    ])
    expect(desktop.posted).toEqual([])
    expect(useCanvasPreviewStore.getState().inspector.cssChanges).toHaveLength(1)
  })

  it("switches to a focused preview's tree and keeps pending edits until they are taken", () => {
    const store = useCanvasPreviewStore.getState()
    store.reportDomTree("a", "desktop", tree("main"))
    store.reportElement("b", "tablet", "http://localhost:3001/", element)
    store.applyStyle("color", "red")

    store.focusViewport("a", "desktop", "http://localhost:5173/")
    let state = useCanvasPreviewStore.getState()
    expect(state.focus?.key).toBe("a::desktop")
    expect(state.inspector.tree?.tag).toBe("main")
    expect(state.inspector.selected).toBeNull()
    expect(state.inspector.cssChanges).toHaveLength(1)

    expect(state.takeCssChanges()).toHaveLength(1)
    state = useCanvasPreviewStore.getState()
    expect(state.inspector.cssChanges).toEqual([])
    expect(state.takeCssChanges()).toEqual([])
  })

  it("drops a page's tree on navigation and its focus when the viewport unmounts", () => {
    const store = useCanvasPreviewStore.getState()
    store.reportElement("a", "desktop", "http://localhost:5173/", element)
    store.reportDomTree("a", "desktop", tree("main"))
    store.reportNavigation("a", "desktop", "http://localhost:5173/about")
    let state = useCanvasPreviewStore.getState()
    expect(state.focus?.pageUrl).toBe("http://localhost:5173/about")
    expect(state.inspector.tree).toBeNull()
    expect(state.inspector.selected).toBeNull()

    // A tree for another card never leaks into the focused inspector.
    store.reportDomTree("b", "tablet", tree("nav"))
    expect(useCanvasPreviewStore.getState().inspector.tree).toBeNull()

    store.forgetViewport("a", "desktop")
    state = useCanvasPreviewStore.getState()
    expect(state.focus).toBeNull()
    expect(state.treesByViewport).toEqual({ "b::tablet": tree("nav") })
  })

  it("ignores style edits without a focused page instead of throwing", () => {
    const store = useCanvasPreviewStore.getState()
    expect(() => store.applyStyle("color", "red")).not.toThrow()
    expect(() => store.highlight("#buy")).not.toThrow()
    expect(useCanvasPreviewStore.getState().inspector.cssChanges).toEqual([])
  })
})
