import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ComponentProps } from "react"
import { designBriefSchema, type ChatThread } from "@betterc0de/schema"
import type { ThreadSettings, ThreadStreamState } from "@/lib/chat/types"
import type { DesignArtboard } from "./design-artboard"
import { DesignCanvas } from "./design-canvas"

const fixture = vi.hoisted(() => ({
  threads: [] as ChatThread[],
  settingsByThread: {} as Record<string, ThreadSettings>,
  streamingByThread: {} as Record<string, Partial<ThreadStreamState>>,
  views: [] as ComponentProps<typeof DesignArtboard>[],
  roots: [] as Array<string | null>,
  setThreadSetting: vi.fn(),
  setActiveThread: vi.fn(),
  add: vi.fn(() => true),
}))
vi.mock("@/lib/chat-store", () => ({
  useChatStore: Object.assign(
    (select: (state: typeof fixture) => unknown) => select(fixture),
    { getState: () => fixture }
  ),
  useThreadActivities: () => [],
}))
vi.mock("./canvas-runtime-pane", () => ({
  CanvasRuntimePane: (props: {
    threadId: string
    width: number
    deviceIds: string[]
  }) => (
    <div
      data-test-runtime={props.threadId}
      data-test-runtime-width={props.width}
      data-test-runtime-devices={props.deviceIds.join(",")}
    />
  ),
}))
vi.mock("@/lib/chat/running-selectors", () => ({
  useThreadRunningElapsed: () => null,
  useThreadIsRunning: (id: string) =>
    Boolean(
      fixture.streamingByThread[id]?.isStreaming ||
      fixture.threads.find((thread) => thread.id === id)?.session?.activeTurnId
    ),
}))
vi.mock("@/lib/get-model-info", () => ({
  getModelInfo: (id?: string) => (id ? { name: id } : undefined),
}))
vi.mock("@/hooks/use-workspace-branch", () => ({
  useWorkspaceBranch: (path: string | null) => ({
    label:
      path === "C:/worktrees/shop-feature"
        ? "feature/shop"
        : "release/dashboard",
    status: "ready",
    refresh: vi.fn(),
  }),
}))
vi.mock("@/lib/browser-context-store", () => ({
  MAX_BROWSER_ELEMENTS: 10,
  useBrowserContextStore: { getState: () => ({ add: fixture.add }) },
}))
vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn() } }))
vi.mock("@/hooks/use-dev-server", () => ({
  useDevServer: (root: string | null) => {
    fixture.roots.push(root)
    return {
      status: "idle",
      managed: false,
      logs: [],
      url: null,
      probe: vi.fn(),
    }
  },
}))
vi.mock("./design-artboard", () => ({
  DesignArtboard: (props: ComponentProps<typeof DesignArtboard>) => {
    fixture.views.push(props)
    return <div data-test-preview={props.url} />
  },
}))
vi.mock("./canvas-project-picker", () => ({ CanvasProjectPicker: () => null }))

describe("one canvas with independent project frames", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixture.views = []
    fixture.roots = []
    fixture.threads = [
      {
        id: "a",
        title: "Storefront",
        projectName: "Shop",
        projectPath: "C:/shop",
        worktreePath: "C:/worktrees/shop-feature",
        branch: "stale-recorded-branch",
        messages: [],
        createdAt: "2026-09-14",
        updatedAt: "2026-09-14",
      },
      {
        id: "b",
        title: "Account area",
        projectName: "Dashboard",
        projectPath: "C:/dashboard",
        messages: [],
        createdAt: "2026-09-14",
        updatedAt: "2026-09-14",
      },
    ]
    fixture.settingsByThread = {
      a: {
        designPreviewUrl: "http://localhost:5173",
        designDevicePresets: ["desktop", "mobile"],
      },
      b: {
        designPreviewUrl: "http://localhost:3001",
        designDevicePreset: "tablet",
      },
    }
    fixture.streamingByThread = { a: { isStreaming: true }, b: {} }
    vi.stubGlobal("localStorage", {
      getItem: () =>
        '[{"threadId":"a","x":0,"y":0},{"threadId":"b","x":1000,"y":0}]',
    })
    vi.stubGlobal("window", { dispatchEvent: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())
  it("uses one transformed stage for both repos, with separate devices and worktree roots", () => {
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html.match(/data-canvas-stage=/g)).toHaveLength(1)
    expect(html.match(/data-canvas-project=/g)).toHaveLength(2)
    expect(html).toContain("C:/worktrees/shop-feature")
    expect(html).toContain("feature/shop")
    expect(html).not.toContain("stale-recorded-branch")
    expect(fixture.roots).toEqual(["C:/worktrees/shop-feature", "C:/dashboard"])
    expect(fixture.views.map((view) => [view.preset.id, view.url])).toEqual([
      ["desktop", "http://localhost:5173/"],
      ["mobile", "http://localhost:5173/"],
      ["tablet", "http://localhost:3001/"],
    ])
    expect(html).not.toContain("Edit design brief")
    expect(html).not.toContain("Saved design brief")
    expect(html).not.toMatch(/animate-spin|animate-pulse/)
  })
  it("keeps a working cue on only its owning project", () => {
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html.match(/data-working="true"/g)).toHaveLength(1)
    expect(html).toContain("Working")
    expect(html).toContain("Idle")
  })
  it("keeps existing briefs accessible without offering the removed setup flow", () => {
    fixture.settingsByThread.a.designBrief = designBriefSchema.parse({
      target: "website",
      colorMode: "dark",
      description: "Keep the storefront's current design",
    })
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html.match(/aria-label="Saved design brief"/g)).toHaveLength(1)
    expect(html).not.toContain("Edit design brief")
    expect(html).not.toContain('role="dialog"')
    expect(fixture.setThreadSetting).not.toHaveBeenCalled()
  })
  it("shows each card's live or selected model independently of the active chat", () => {
    fixture.streamingByThread.a.streamingModelId = "running-a"
    fixture.settingsByThread.a.selectedModel = "next-a"
    fixture.settingsByThread.b.selectedModel = "selected-b"
    fixture.settingsByThread.b.selectedProviderId = "provider-b"
    fixture.threads[1].lastModelId = "old-b"
    const html = renderToStaticMarkup(
      <DesignCanvas
        activeThreadId="b"
        providers={[
          {
            id: "provider-b",
            name: "Provider B",
            logo: "",
            models: [
              {
                id: "selected-b",
                name: "Live catalog name",
                context: "",
                tier: "",
              },
            ],
          },
        ]}
      />
    )
    expect(html).toContain('aria-label="Running model: running-a"')
    expect(html).toContain('aria-label="Selected model: Live catalog name"')
    expect(html).toContain('data-canvas-model="current"')
    expect(html).toContain('data-canvas-model="selected"')
    expect(html).not.toContain("old-b")
    expect(html).not.toContain("next-a")
    expect(html).toContain("Worktree")
  })
  it("leaves removed frames out of the shared stage, even if their chat is active", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        '[{"threadId":"a","x":0,"y":0,"hidden":true},{"threadId":"b","x":1000,"y":0}]',
    })
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="a" />)
    expect(html).not.toContain('data-canvas-project="a"')
    expect(html).toContain('data-canvas-project="b"')
  })
  it("routes a preview pick to its source chat while another is active", () => {
    renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    fixture.views[0].onElementSelected({
      selector: "#buy",
      tagName: "button",
      id: "buy",
      className: "",
      text: "Buy",
      childCount: 0,
      styles: {},
      rect: { x: 0, y: 0, w: 60, h: 24 },
    })
    expect(fixture.add).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        selector: "#buy",
        url: "http://localhost:5173/",
      })
    )
    expect(fixture.setActiveThread).toHaveBeenCalledWith("a")
  })
  it("scales the whole card once and preserves its internal device layout", () => {
    const before = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    const tabletWidth = (html: string) =>
      Number(
        html.match(/data-canvas-device="tablet"[^>]*style="width:(\d+)px"/)?.[1]
      )
    expect(before).toContain('aria-label="Resize Shop card"')
    expect(before).toContain('aria-label="Resize Dashboard card"')
    expect(before).toContain('data-card-scale="1"')

    fixture.settingsByThread.b = {
      ...fixture.settingsByThread.b,
      designCardScale: 2,
    }
    const after = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(after).toContain('data-card-scale="2"')
    expect(tabletWidth(after)).toBe(tabletWidth(before))
    expect(after).toMatch(
      /<article[^>]*data-canvas-project="b"[^>]*transform:scale\(2\)/
    )
    expect(after).toMatch(
      /<article[^>]*data-canvas-project="a"[^>]*transform:scale\(1\)/
    )
  })
  it("keeps device layout stable under Electron and scales only its canvas wrapper", () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), electronAPI: {} })
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html).not.toContain("data-canvas-crisp")
    expect(fixture.views.map((view) => view.preset.width)).toEqual([
      1440, 375, 768,
    ])
    expect(html).toContain("transform:scale(0.5)")
    expect(html).toMatch(/<footer[\s\S]*aria-label="Resize Shop card"/)
  })
  // The canvas toolbar carries the editor's Select ⇄ Browse toggle and an
  // Elements button; every artboard follows the shared selection mode.
  it("offers the editor's Select/Browse toggle and the Elements panel from its toolbar", () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn(), electronAPI: {} })
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html).toContain('aria-label="Select elements for chat"')
    expect(html).toContain(
      'aria-label="Elements — inspect and edit the focused preview"'
    )
    expect(html).not.toContain("Send to AI")
    expect(
      fixture.views.every((view) => typeof view.selectionMode === "boolean")
    ).toBe(true)
    expect(
      fixture.views.every((view) => typeof view.onDomTree === "function")
    ).toBe(true)
  })

  it("adds a runtime pane to a card that asked for one, sized with the card", () => {
    fixture.settingsByThread.a = {
      ...fixture.settingsByThread.a,
      designRuntimePane: true,
    }
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html.match(/data-test-runtime=/g)).toHaveLength(1)
    expect(html).toContain('data-test-runtime="a"')
    expect(html).toContain('data-test-runtime-width="420"')
    expect(html).toContain('data-test-runtime-devices="desktop,mobile"')
    expect(html).toContain(
      'title="Toggle runtime pane (requests, endpoints, logs, tools)"'
    )
    // The card grows to make room for it.
    const widthOf = (markup: string, id: string) =>
      Number(
        markup
          .split(`data-canvas-position="${id}"`)[1]
          ?.split(">")[0]
          ?.match(/width:([\d.]+)px/)?.[1]
      )
    fixture.settingsByThread.a = {
      ...fixture.settingsByThread.a,
      designRuntimePane: undefined,
    }
    const without = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(widthOf(html, "a") - widthOf(without, "a")).toBe(420 + 16)
  })

  it("keeps the transform path for iframe previews outside Electron", () => {
    const html = renderToStaticMarkup(<DesignCanvas activeThreadId="b" />)
    expect(html).not.toContain("data-canvas-crisp")
    expect(html).toContain("transform:scale(0.5)")
  })
})
