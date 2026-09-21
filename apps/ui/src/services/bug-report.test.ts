import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("./ipc-facade", () => ({ ipcApi: { bugReport: { send } } }))

const report = { message: "Console report", stack: "Error: failed" }
const loadStore = async () => (await import("./bug-report")).useBugReportStore

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  send.mockReset().mockResolvedValue({ ok: true, retryAfterMs: 10_000 })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("manual bug report sending", () => {
  it("only sends on request and keeps its countdown when the panel unsubscribes", async () => {
    const store = await loadStore()
    expect(send).not.toHaveBeenCalled()
    const unsubscribe = store.subscribe(vi.fn())
    await store.getState().send(report)
    expect(send).toHaveBeenCalledWith(report)
    expect(store.getState().feedback).toEqual({ ok: true, message: "Report sent. Thank you!" })
    unsubscribe()
    vi.advanceTimersByTime(9000)
    expect(store.getState().cooldownSeconds).toBe(1)
    await store.getState().send(report)
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(store.getState().cooldownSeconds).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    await store.getState().send(report)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("blocks double clicks and stays disabled while a slow upload is pending", async () => {
    let finish!: (value: { ok: true; retryAfterMs: number }) => void
    send.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const store = await loadStore()
    const request = store.getState().send(report)
    await store.getState().send(report)
    vi.advanceTimersByTime(11_000)
    await store.getState().send(report)
    expect(send).toHaveBeenCalledTimes(1)
    expect(store.getState().pending).toBe(true)
    finish({ ok: true, retryAfterMs: 0 })
    await request
    expect(store.getState().pending).toBe(false)
    expect(store.getState().cooldownSeconds).toBe(0)
  })

  it("shows API errors and preserves the cooldown before retrying", async () => {
    send.mockResolvedValue({ ok: false, error: "Server unavailable", retryAfterMs: 10_000 })
    const store = await loadStore()
    await store.getState().send(report)
    expect(store.getState().feedback).toEqual({ ok: false, message: "Server unavailable" })
    expect(store.getState().pending).toBe(false)
    expect(store.getState().cooldownSeconds).toBe(10)
  })

  it("handles bridge failures without leaving the send button stuck", async () => {
    send.mockRejectedValue(new Error("Restart the app"))
    const store = await loadStore()
    await store.getState().send(report)
    expect(store.getState().feedback).toEqual({ ok: false, message: "Restart the app" })
    expect(store.getState().pending).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(store.getState().cooldownSeconds).toBe(0)
  })
})
