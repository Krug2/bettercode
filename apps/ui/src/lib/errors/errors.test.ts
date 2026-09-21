import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AppError, HttpError, IpcError, ValidationError, TimeoutError } from "./types"
import { handleError } from "./handle"
import { registerErrorToastBridge } from "../toast"
import { toast as sonnerToast } from "sonner"
import { useSettingsStore } from "@/lib/settings-store"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock("@/lib/settings-store", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ toastEnabled: true, toastErrors: true })),
  },
}))

describe("error types", () => {
  it("AppError preserves message and cause", () => {
    const cause = new Error("underlying")
    const err = new AppError("wrapped", { cause, code: "E_X" })
    expect(err.message).toBe("wrapped")
    expect(err.cause).toBe(cause)
    expect(err.code).toBe("E_X")
    expect(err.name).toBe("AppError")
    expect(err).toBeInstanceOf(Error)
  })

  it("HttpError carries status and path", () => {
    const err = new HttpError("Not Found", 404, "/threads/xyz")
    expect(err.status).toBe(404)
    expect(err.path).toBe("/threads/xyz")
    expect(err.name).toBe("HttpError")
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(HttpError)
  })

  it("IpcError carries channel", () => {
    const err = new IpcError("invoke failed", "claude:send")
    expect(err.channel).toBe("claude:send")
    expect(err).toBeInstanceOf(AppError)
  })

  it("ValidationError carries issues", () => {
    const issues = [{ path: ["a"], message: "bad" }]
    const err = new ValidationError("invalid", issues)
    expect(err.issues).toBe(issues)
    expect(err).toBeInstanceOf(AppError)
  })

  it("TimeoutError carries timeoutMs", () => {
    const err = new TimeoutError("timed out", 5000)
    expect(err.timeoutMs).toBe(5000)
    expect(err).toBeInstanceOf(AppError)
  })
})

describe("handleError normalisation", () => {
  beforeEach(() => {
    delete (globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__
  })

  it("returns the same AppError when one is thrown", () => {
    const original = new HttpError("500", 500, "/x")
    const result = handleError(original, { source: "test", silent: true })
    expect(result).toBe(original)
  })

  it("wraps a plain Error into AppError preserving message", () => {
    const result = handleError(new Error("boom"), { source: "test", silent: true })
    expect(result).toBeInstanceOf(AppError)
    expect(result.message).toBe("boom")
  })

  it("coerces a plain string throw into AppError", () => {
    const result = handleError("bare string", { source: "test", silent: true })
    expect(result).toBeInstanceOf(AppError)
    expect(result.message).toBe("bare string")
  })

  it("coerces unknown values into AppError('Unknown error')", () => {
    const result = handleError({ weird: true }, { source: "test", silent: true })
    expect(result).toBeInstanceOf(AppError)
    expect(result.message).toBe("Unknown error")
    expect(result.cause).toEqual({ weird: true })
  })

  it("invokes the toast bridge when silent is false", () => {
    const spy = vi.fn()
    ;(globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__ = spy
    handleError(new Error("boom"), { source: "scope" })
    expect(spy).toHaveBeenCalledWith("boom", "scope")
  })

  it("skips the toast bridge when silent is true", () => {
    const spy = vi.fn()
    ;(globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__ = spy
    handleError(new Error("boom"), { source: "scope", silent: true })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("registerErrorToastBridge", () => {
  beforeEach(() => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      toastEnabled: true,
      toastErrors: true,
    } as never)
  })

  afterEach(() => {
    delete (globalThis as { __BETTERC0DE_TOAST__?: unknown })
      .__BETTERC0DE_TOAST__
    vi.clearAllMocks()
  })

  it("registers the bus with the (message, source) signature and unregisters", () => {
    const unregister = registerErrorToastBridge()
    const bus = (
      globalThis as {
        __BETTERC0DE_TOAST__?: (message: string, source: string) => void
      }
    ).__BETTERC0DE_TOAST__
    expect(typeof bus).toBe("function")
    bus?.("boom", "chat-submit")
    expect(sonnerToast.error).toHaveBeenCalledWith("boom", {
      description: "chat-submit",
      id: "err:chat-submit:boom",
    })
    unregister()
    expect(
      (globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__
    ).toBeUndefined()
  })

  it("handleError surfaces through the registered bridge", () => {
    registerErrorToastBridge()
    handleError(new Error("kaputt"), { source: "ws" })
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "kaputt",
      expect.objectContaining({ description: "ws" })
    )
  })

  it("respects the toastEnabled gate", () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      toastEnabled: false,
      toastErrors: true,
    } as never)
    registerErrorToastBridge()
    handleError(new Error("gated"), { source: "ws" })
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it("respects the toastErrors gate", () => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      toastEnabled: true,
      toastErrors: false,
    } as never)
    registerErrorToastBridge()
    handleError(new Error("gated"), { source: "ws" })
    expect(sonnerToast.error).not.toHaveBeenCalled()
  })

  it("does not unregister a foreign bus", () => {
    const unregister = registerErrorToastBridge()
    const foreign = vi.fn()
    ;(globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__ =
      foreign
    unregister()
    expect(
      (globalThis as { __BETTERC0DE_TOAST__?: unknown }).__BETTERC0DE_TOAST__
    ).toBe(foreign)
  })
})
