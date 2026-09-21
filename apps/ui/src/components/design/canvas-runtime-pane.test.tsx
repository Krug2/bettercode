import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ThreadActivity } from "@betterc0de/schema"
import type { UseDevServerResult } from "@/hooks/use-dev-server"
import type { ConsoleLog } from "@/components/browser-preview/types"
import type { PreviewRequestEntry } from "./canvas-runtime"
import { CanvasRuntimePane } from "./canvas-runtime-pane"

// Static rendering reads a zustand store's initial snapshot, so the stores
// are mocked as selectors over a fixture (see canvas-element-inspector.test).
const fixture = vi.hoisted(() => ({
  requestsByGuest: {} as Record<number, PreviewRequestEntry[]>,
  consoleByViewport: {} as Record<string, ConsoleLog[]>,
  activities: [] as ThreadActivity[],
  guestIds: {} as Record<string, number | null>,
  clearRequests: vi.fn(),
  clearConsole: vi.fn(),
  feed: vi.fn(),
  hydrate: vi.fn(),
  // used by the mocked modules only
}))
vi.mock("./canvas-runtime-store", () => ({
  useCanvasRuntimeStore: (select: (state: typeof fixture) => unknown) =>
    select(fixture),
  ensurePreviewRequestFeed: fixture.feed,
}))
vi.mock("./canvas-preview-store", () => ({
  canvasViewportKey: (threadId: string, deviceId: string) =>
    `${threadId}::${deviceId}`,
  canvasViewport: (key: string) =>
    key in fixture.guestIds
      ? { getWebContentsId: () => fixture.guestIds[key] }
      : null,
}))
vi.mock("@/lib/chat-store", () => ({
  useThreadActivities: () => fixture.activities,
  useChatStore: {
    getState: () => ({ hydrateThreadActivities: fixture.hydrate }),
  },
}))

const dev = {
  status: "running",
  url: "http://localhost:3000",
  scriptName: "dev",
  packageManager: "npm",
  logs: ["> vite", "ready in 300 ms"],
  exitCode: null,
  error: null,
  managed: true,
  slowStart: false,
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  probe: vi.fn(),
} as unknown as UseDevServerResult

function entry(overrides: Partial<PreviewRequestEntry>): PreviewRequestEntry {
  return {
    id: "1",
    webContentsId: 7,
    method: "GET",
    url: "http://localhost:3000/api/items",
    resourceType: "xhr",
    startedAt: 1000,
    durationMs: 40,
    statusCode: 200,
    fromCache: false,
    error: null,
    ...overrides,
  }
}

const render = () =>
  renderToStaticMarkup(
    <CanvasRuntimePane
      threadId="a"
      deviceIds={["desktop", "mobile"]}
      dev={dev}
      width={420}
      height={450}
    />
  )

describe("CanvasRuntimePane", () => {
  beforeEach(() => {
    fixture.requestsByGuest = {}
    fixture.consoleByViewport = {}
    fixture.activities = []
    fixture.guestIds = { "a::desktop": 7, "a::mobile": null }
  })

  it("lists the API requests of this card's guests only, newest first, with failures counted", () => {
    fixture.requestsByGuest = {
      7: [
        entry({ id: "1", startedAt: 1000 }),
        entry({
          id: "2",
          startedAt: 2000,
          url: "http://localhost:3000/api/items/9",
          statusCode: 404,
        }),
        entry({
          id: "3",
          startedAt: 3000,
          url: "http://localhost:3000/",
          resourceType: "mainFrame",
        }),
      ],
      8: [
        entry({
          id: "9",
          webContentsId: 8,
          url: "http://localhost:4000/other",
        }),
      ],
    }
    const html = render()
    expect(html).toContain('data-canvas-runtime="a"')
    expect(html).toContain("3 requests · 0 tools")
    expect(html).toContain("1 failed")
    expect(html.indexOf("/api/items/9")).toBeLessThan(
      html.indexOf("/api/items<")
    )
    expect(html).not.toContain("/other")
    // Page loads stay behind the API-only filter.
    expect(html).not.toContain("mainFrame")
  })

  it("explains an empty pane and tells the server states apart", () => {
    const html = render()
    expect(html).toContain("No API calls yet")
    expect(html).toContain('aria-label="Runtime view"')
    expect(html).toMatch(/Requests|Endpoints|Logs|Tools/)
    // Effects do not run under static rendering; the feed subscription and
    // the activity hydration are covered by their own store tests.
  })

  it("explains hidden development traffic without presenting it as an API request", () => {
    fixture.requestsByGuest = {
      7: [
        entry({
          resourceType: "webSocket",
          url: "ws://localhost:3000/_next/hmr?id=client",
          statusCode: 101,
        }),
      ],
    }
    const html = render()
    expect(html).toContain("No API calls yet")
    expect(html).toContain("View all requests")
    expect(html).toContain("0 of 1 request")
    expect(html).not.toContain("/_next/hmr")
  })
})
