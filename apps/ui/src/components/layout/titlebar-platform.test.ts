import { describe, expect, it } from "vitest"
import {
  isMacTitlebarPlatform,
  shouldRenderCustomWindowControls,
} from "@/components/layout/titlebar-platform"

describe("titlebar platform helpers", () => {
  it("treats Electron darwin and Mac navigator platforms as macOS", () => {
    expect(isMacTitlebarPlatform("darwin", undefined)).toBe(true)
    expect(isMacTitlebarPlatform(undefined, "MacIntel")).toBe(true)
  })

  it("keeps custom window controls off on macOS", () => {
    expect(
      shouldRenderCustomWindowControls({
        electronPlatform: "darwin",
        navigatorPlatform: "MacIntel",
        hasWindowControlIpc: true,
      })
    ).toBe(false)
  })

  it("keeps custom window controls on for Windows and Linux Electron windows", () => {
    expect(
      shouldRenderCustomWindowControls({
        electronPlatform: "win32",
        navigatorPlatform: "Win32",
        hasWindowControlIpc: true,
      })
    ).toBe(true)
    expect(
      shouldRenderCustomWindowControls({
        electronPlatform: "linux",
        navigatorPlatform: "Linux x86_64",
        hasWindowControlIpc: true,
      })
    ).toBe(true)
  })
})
