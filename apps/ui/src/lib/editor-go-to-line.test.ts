import { afterEach, describe, expect, it, vi } from "vitest"
import {
  countEditorLines,
  dispatchEditorGotoLine,
  EDITOR_GOTO_LINE_EVENT,
  parseGoToLineQuery,
} from "@/lib/editor-go-to-line"

class TestCustomEvent<T = unknown> extends Event {
  readonly detail: T

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type)
    this.detail = init?.detail as T
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseGoToLineQuery", () => {
  it("parses a line number", () => {
    expect(parseGoToLineQuery("42")).toEqual({ line: 42, column: 1 })
  })

  it("parses line and column with colon or comma separators", () => {
    expect(parseGoToLineQuery("42:7")).toEqual({ line: 42, column: 7 })
    expect(parseGoToLineQuery("42, 7")).toEqual({ line: 42, column: 7 })
  })

  it("trims surrounding whitespace", () => {
    expect(parseGoToLineQuery("  9 : 3  ")).toEqual({ line: 9, column: 3 })
  })

  it("rejects invalid or non-positive locations", () => {
    expect(parseGoToLineQuery("")).toBeNull()
    expect(parseGoToLineQuery("abc")).toBeNull()
    expect(parseGoToLineQuery("0")).toBeNull()
    expect(parseGoToLineQuery("4:0")).toBeNull()
    expect(parseGoToLineQuery("4:5:6")).toBeNull()
  })

  it("clamps absolute line targets to the file bounds", () => {
    expect(parseGoToLineQuery("999", { maxLine: 25 })).toEqual({
      line: 25,
      column: 1,
    })
  })

  it("parses relative line jumps from the current cursor", () => {
    expect(
      parseGoToLineQuery("+10", { currentLine: 20, currentColumn: 4 })
    ).toEqual({ line: 30, column: 4 })
    expect(
      parseGoToLineQuery("-30:2", {
        currentLine: 20,
        currentColumn: 4,
        maxLine: 80,
      })
    ).toEqual({ line: 1, column: 2 })
  })

  it("requires current line context for relative jumps", () => {
    expect(parseGoToLineQuery("+5")).toBeNull()
  })
})

describe("countEditorLines", () => {
  it("counts empty, unix, windows, and trailing-newline editor content", () => {
    expect(countEditorLines("")).toBe(1)
    expect(countEditorLines("one\ntwo\nthree")).toBe(3)
    expect(countEditorLines("one\r\ntwo")).toBe(2)
    expect(countEditorLines("one\n")).toBe(2)
  })
})

describe("dispatchEditorGotoLine", () => {
  it("dispatches editor goto-line details", () => {
    const target = new EventTarget()
    vi.stubGlobal("CustomEvent", TestCustomEvent)
    vi.stubGlobal(
      "window",
      Object.assign(target, {
        setTimeout: vi.fn(),
      })
    )

    const events: Array<CustomEvent<{ filePath?: string; line?: number }>> = []
    window.addEventListener(EDITOR_GOTO_LINE_EVENT, (event) => {
      events.push(event as CustomEvent<{ filePath?: string; line?: number }>)
    })

    dispatchEditorGotoLine({
      filePath: "/repo/src/app.ts",
      line: 42,
      column: 7,
      endLine: 45,
      endColumn: 3,
      preserveNavigation: true,
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.detail).toEqual({
      filePath: "/repo/src/app.ts",
      line: 42,
      column: 7,
      endLine: 45,
      endColumn: 3,
      preserveNavigation: true,
    })
  })

  it("can defer dispatch until the editor has mounted", () => {
    const target = new EventTarget()
    const setTimeout = vi.fn((callback: () => void) => {
      callback()
      return 1
    })
    vi.stubGlobal("CustomEvent", TestCustomEvent)
    vi.stubGlobal("window", Object.assign(target, { setTimeout }))

    const events: Array<CustomEvent<{ line?: number }>> = []
    window.addEventListener(EDITOR_GOTO_LINE_EVENT, (event) => {
      events.push(event as CustomEvent<{ line?: number }>)
    })

    dispatchEditorGotoLine({ line: 9, column: 1 }, { defer: true })

    expect(setTimeout).toHaveBeenCalledTimes(1)
    expect(events[0]?.detail.line).toBe(9)
  })
})
