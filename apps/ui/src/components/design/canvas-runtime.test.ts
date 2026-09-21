import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import type { ThreadActivity } from "@betterc0de/schema"
import {
  appendCapped,
  canReplayEndpoint,
  foldToolActivities,
  formatMillis,
  groupEndpoints,
  isApiRequest,
  isDevelopmentRequest,
  parsePreviewRequest,
  replayScript,
  type PreviewRequestEntry,
} from "./canvas-runtime"

const requireCjs = createRequire(import.meta.url)
const capture = requireCjs("../../../../shell/preview-request-capture.cjs") as {
  previewRequestEntry: (
    details: unknown,
    startedAt: number | undefined,
    outcome: unknown
  ) => unknown
  installPreviewRequestCapture: (
    session: unknown,
    emit: (entry: unknown) => void
  ) => void
  PREVIEW_REQUEST_STATIC_TYPES: Set<string>
}

function request(overrides: Partial<PreviewRequestEntry>): PreviewRequestEntry {
  return {
    id: "1",
    webContentsId: 7,
    method: "GET",
    url: "http://localhost:3000/api/items?page=1",
    resourceType: "xhr",
    startedAt: 1000,
    durationMs: 40,
    statusCode: 200,
    fromCache: false,
    error: null,
    ...overrides,
  }
}

function activity(
  kind: string,
  toolId: string,
  createdAt: string,
  summary = "Read file"
): ThreadActivity {
  return {
    id: `${kind}-${toolId}-${createdAt}`,
    threadId: "t",
    kind,
    tone: kind === "tool.failed" ? "error" : "tool",
    summary,
    payload: { toolId },
    createdAt,
  }
}

describe("shell request capture", () => {
  it("shapes a finished request the way the renderer parses it, timing it from the send", () => {
    const entry = capture.previewRequestEntry(
      {
        id: 9,
        webContentsId: 7,
        method: "post",
        url: "http://localhost:3000/api/items",
        resourceType: "xhr",
        timestamp: 1500,
        statusCode: 201,
        fromCache: false,
      },
      1400,
      { statusCode: 201, error: null }
    )
    expect(parsePreviewRequest(entry)).toEqual({
      id: "9",
      webContentsId: 7,
      method: "POST",
      url: "http://localhost:3000/api/items",
      resourceType: "xhr",
      startedAt: 1400,
      durationMs: 100,
      statusCode: 201,
      fromCache: false,
      error: null,
    })
    // A request whose start was never seen still reports, with zero duration.
    const late = parsePreviewRequest(
      capture.previewRequestEntry(
        {
          id: 10,
          webContentsId: 7,
          method: "GET",
          url: "http://localhost:3000/x",
          resourceType: "other",
          timestamp: 2000,
        },
        undefined,
        { statusCode: null, error: "net::ERR_CONNECTION_REFUSED" }
      )
    )
    expect(late).toMatchObject({
      durationMs: 0,
      statusCode: null,
      error: "net::ERR_CONNECTION_REFUSED",
    })
    expect(parsePreviewRequest({ id: "x" })).toBeNull()
  })

  it("skips static assets and never blocks the guest's requests", () => {
    const listeners: Record<
      string,
      (details: Record<string, unknown>) => void
    > = {}
    const session = {
      webRequest: {
        onSendHeaders: (fn: (d: Record<string, unknown>) => void) => {
          listeners.send = fn
        },
        onCompleted: (fn: (d: Record<string, unknown>) => void) => {
          listeners.completed = fn
        },
        onErrorOccurred: (fn: (d: Record<string, unknown>) => void) => {
          listeners.error = fn
        },
      },
    }
    const emitted: unknown[] = []
    capture.installPreviewRequestCapture(session, (entry) =>
      emitted.push(entry)
    )
    // The listeners take no callback: non-blocking by construction.
    expect(listeners.send.length).toBe(1)
    listeners.send({
      id: 1,
      resourceType: "image",
      timestamp: 10,
      url: "http://localhost:3000/logo.png",
      method: "GET",
      webContentsId: 7,
    })
    listeners.completed({
      id: 1,
      resourceType: "image",
      timestamp: 20,
      url: "http://localhost:3000/logo.png",
      method: "GET",
      webContentsId: 7,
      statusCode: 200,
    })
    listeners.send({
      id: 2,
      resourceType: "xhr",
      timestamp: 10,
      url: "http://localhost:3000/api/me",
      method: "GET",
      webContentsId: 7,
    })
    listeners.completed({
      id: 2,
      resourceType: "xhr",
      timestamp: 35,
      url: "http://localhost:3000/api/me",
      method: "GET",
      webContentsId: 7,
      statusCode: 200,
    })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      id: "2",
      durationMs: 25,
      statusCode: 200,
    })
    expect(capture.PREVIEW_REQUEST_STATIC_TYPES.has("script")).toBe(true)
    expect(capture.PREVIEW_REQUEST_STATIC_TYPES.has("xhr")).toBe(false)
  })
})

describe("canvas runtime derivations", () => {
  it("groups requests into endpoints without their query strings, newest first", () => {
    const endpoints = groupEndpoints([
      request({ id: "1", startedAt: 1000, durationMs: 40 }),
      request({
        id: "2",
        startedAt: 3000,
        durationMs: 60,
        url: "http://localhost:3000/api/items?page=2",
        statusCode: 500,
      }),
      request({
        id: "3",
        startedAt: 2000,
        method: "POST",
        url: "http://localhost:3000/api/items",
        statusCode: 201,
      }),
      request({
        id: "4",
        startedAt: 1500,
        url: "not a url",
        statusCode: null,
        error: "net::ERR_FAILED",
      }),
    ])
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      "GET /api/items",
      "POST /api/items",
      "GET not a url",
    ])
    expect(endpoints[0]).toMatchObject({
      count: 2,
      lastStatus: 500,
      averageMs: 50,
      lastUrl: "http://localhost:3000/api/items?page=2",
      origin: "http://localhost:3000",
    })
    expect(endpoints[2]).toMatchObject({
      lastError: "net::ERR_FAILED",
      origin: "",
    })
    expect(canReplayEndpoint(endpoints[0])).toBe(true)
    expect(canReplayEndpoint(endpoints[1])).toBe(false)
    expect(replayScript("http://localhost:3000/api/items?page=2")).toContain(
      'fetch("http://localhost:3000/api/items?page=2"'
    )
  })

  it("tells API traffic from page loads and caps a ring buffer", () => {
    expect(isApiRequest(request({ resourceType: "xhr" }))).toBe(true)
    expect(isApiRequest(request({ resourceType: "mainFrame" }))).toBe(false)
    expect(isApiRequest(request({ resourceType: "other" }))).toBe(false)
    const list = [1, 2, 3]
    expect(appendCapped(list, [], 3)).toBe(list)
    expect(appendCapped(list, [4, 5], 3)).toEqual([3, 4, 5])
  })

  it.each([
    "http://localhost:3000/_next/hmr?id=connection",
    "ws://localhost:3000/_next/webpack-hmr",
    "ws://localhost:3000/dashboard/_next/webpack-hmr?client=1",
  ])("excludes development connections from API traffic: %s", (url) => {
    const entry = request({ resourceType: "webSocket", url, statusCode: 101 })
    expect(isDevelopmentRequest(entry)).toBe(true)
    expect(isApiRequest(entry)).toBe(false)
  })

  it.each([
    "ws://localhost:3000/live",
    "http://localhost:3000/api/events?path=/_next/hmr",
    "http://localhost:3000/_next/hmr-statistics",
  ])("keeps application traffic in the API filter: %s", (url) => {
    expect(isApiRequest(request({ resourceType: "webSocket", url }))).toBe(true)
  })

  it("tolerates malformed request URLs", () => {
    expect(isDevelopmentRequest(request({ url: "not a url" }))).toBe(false)
  })

  it("folds tool activities into runs whose terminal state survives late updates", () => {
    const runs = foldToolActivities([
      activity("tool.started", "a", "2026-09-17T10:00:00.000Z"),
      activity("tool.updated", "a", "2026-09-17T10:00:01.000Z"),
      activity("tool.started", "b", "2026-09-17T10:00:02.000Z", "Run command"),
      activity("tool.completed", "a", "2026-09-17T10:00:03.000Z"),
      activity("tool.updated", "a", "2026-09-17T10:00:04.000Z"),
      activity(
        "tool.denied",
        "b",
        "2026-09-17T10:00:05.000Z",
        "Denied: Run command"
      ),
      {
        ...activity("turn.completed", "x", "2026-09-17T10:00:06.000Z"),
        tone: "info",
      },
    ])
    expect(runs).toEqual([
      {
        toolId: "b",
        summary: "Denied: Run command",
        status: "denied",
        startedAt: "2026-09-17T10:00:02.000Z",
        endedAt: "2026-09-17T10:00:05.000Z",
      },
      {
        toolId: "a",
        summary: "Read file",
        status: "completed",
        startedAt: "2026-09-17T10:00:00.000Z",
        endedAt: "2026-09-17T10:00:03.000Z",
      },
    ])
    expect(formatMillis(40)).toBe("40 ms")
    expect(formatMillis(3200)).toBe("3.2 s")
    expect(formatMillis(12_000)).toBe("12 s")
  })
})
