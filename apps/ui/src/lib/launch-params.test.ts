import { afterEach, describe, expect, it, vi } from "vitest"
import { _resetLaunchParamsCache, getLaunchParams, getWindowAppMode, setWindowAppMode } from "./launch-params"

function mockWindow(hash: string) {
  const storage = new Map<string, string>()
  vi.stubGlobal("window", {
    location: { hash },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  return storage
}

afterEach(() => { vi.unstubAllGlobals(); _resetLaunchParamsCache() })

describe("per-window launch mode", () => {
  it.each(["agent", "editor", "design"] as const)("boots %s with an encoded workspace without altering its path", (mode) => {
    const cwd = "C:\\Projects\\UI & API #1"
    mockWindow(`#${new URLSearchParams({ mode, cwd })}`)
    expect(getLaunchParams()).toEqual({ mode, cwd })
    expect(getWindowAppMode("agent")).toBe(mode)
  })

  it("keeps a manual mode switch across reloads instead of reapplying the original launch mode", () => {
    mockWindow("#mode=design")
    expect(getWindowAppMode("agent")).toBe("design")
    setWindowAppMode("editor")
    _resetLaunchParamsCache()
    expect(getWindowAppMode("agent")).toBe("editor")
  })

  it("uses shared preferences only to initialize a fresh window", () => {
    mockWindow("")
    expect(getWindowAppMode("agent")).toBe("agent")
    expect(getWindowAppMode("design")).toBe("agent")
    _resetLaunchParamsCache()
    expect(getWindowAppMode("editor")).toBe("agent")
  })

  it("ignores invalid launch and stored modes", () => {
    const storage = mockWindow("#mode=invalid")
    storage.set("betterc0de-window-mode", "invalid")
    expect(getLaunchParams()).toEqual({})
    expect(getWindowAppMode("editor")).toBe("editor")
  })

  it("retains independent mode selection when browser storage is unavailable", () => {
    vi.stubGlobal("window", { location: { hash: "#mode=design" } })
    expect(getWindowAppMode("agent")).toBe("design")
    setWindowAppMode("editor")
    expect(getWindowAppMode("agent")).toBe("editor")
  })
})
