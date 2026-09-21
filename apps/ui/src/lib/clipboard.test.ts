import { afterEach, describe, expect, it, vi } from "vitest"
import { copyText } from "./clipboard"

const showError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: showError } }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe("copyText", () => {
  it("uses the trusted Electron bridge without requesting browser permission", async () => {
    const nativeWrite = vi.fn().mockResolvedValue(undefined)
    const browserWrite = vi.fn().mockRejectedValue(new Error("Write permission denied"))
    vi.stubGlobal("window", { electronAPI: { writeClipboardText: nativeWrite } })
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWrite } })
    await expect(copyText("Selected diagnostics")).resolves.toBe(true)
    expect(nativeWrite).toHaveBeenCalledWith("Selected diagnostics")
    expect(browserWrite).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it("supports the browser client", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await expect(copyText("A plan")).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith("A plan")
  })

  it("handles permission denial without an unhandled rejection or logging copied text", async () => {
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    await expect(copyText("private content")).resolves.toBe(false)
    expect(showError).toHaveBeenCalledOnce()
    expect(JSON.stringify(showError.mock.calls)).not.toContain("private content")
  })
})
