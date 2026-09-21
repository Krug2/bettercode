import { afterEach, describe, expect, it, vi } from "vitest"
import {
  dispatchEditorRevealFile,
  EDITOR_REVEAL_FILE_EVENT,
} from "@/lib/editor-reveal-event"

class TestCustomEvent<T = unknown> extends Event {
  readonly detail: T

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type)
    this.detail = init?.detail as T
  }
}

describe("editor reveal event", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("dispatches the file path as a reveal event detail", () => {
    const target = new EventTarget()
    vi.stubGlobal("CustomEvent", TestCustomEvent)
    vi.stubGlobal(
      "window",
      Object.assign(target, {
        setTimeout: vi.fn(),
      })
    )

    const events: Array<CustomEvent<{ filePath?: string }>> = []
    window.addEventListener(EDITOR_REVEAL_FILE_EVENT, (event) => {
      events.push(event as CustomEvent<{ filePath?: string }>)
    })

    dispatchEditorRevealFile("/workspace/src/app.tsx")

    expect(events).toHaveLength(1)
    expect(events[0]?.detail).toEqual({ filePath: "/workspace/src/app.tsx" })
  })

  it("can defer dispatch until the next UI tick", () => {
    const target = new EventTarget()
    const setTimeout = vi.fn((callback: () => void) => {
      callback()
      return 1
    })
    vi.stubGlobal("CustomEvent", TestCustomEvent)
    vi.stubGlobal("window", Object.assign(target, { setTimeout }))

    const events: Array<CustomEvent<{ filePath?: string }>> = []
    window.addEventListener(EDITOR_REVEAL_FILE_EVENT, (event) => {
      events.push(event as CustomEvent<{ filePath?: string }>)
    })

    dispatchEditorRevealFile("/workspace/src/panel.tsx", { defer: true })

    expect(setTimeout).toHaveBeenCalledTimes(1)
    expect(events[0]?.detail.filePath).toBe("/workspace/src/panel.tsx")
  })
})
