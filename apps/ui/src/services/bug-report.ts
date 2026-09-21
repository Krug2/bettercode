import { create } from "zustand"
import type { BugReportPayload } from "@/types/electron-api"
import { ipcApi } from "./ipc-facade"

type BugReportState = {
  pending: boolean
  cooldownSeconds: number
  feedback: { ok: boolean; message: string } | null
  send: (report: BugReportPayload) => Promise<void>
}

// Keep request state outside the panel so closing it cannot reset the cooldown.
let nextAllowedAt = 0
let timer: ReturnType<typeof setInterval> | undefined

function startCooldown(milliseconds: number) {
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + milliseconds)
  if (timer !== undefined) clearInterval(timer)
  const tick = () => {
    const cooldownSeconds = Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1000))
    useBugReportStore.setState({ cooldownSeconds })
    if (cooldownSeconds === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  timer = setInterval(tick, 250)
  tick()
}

export const useBugReportStore = create<BugReportState>((set, get) => ({
  pending: false,
  cooldownSeconds: 0,
  feedback: null,
  send: async (report) => {
    if (get().pending || Date.now() < nextAllowedAt) return
    set({ pending: true, feedback: null })
    startCooldown(10_000)
    try {
      const result = await ipcApi.bugReport.send(report)
      startCooldown(result.retryAfterMs)
      set({ feedback: { ok: result.ok, message: result.ok ? "Report sent. Thank you!" : result.error } })
    } catch (error) {
      set({ feedback: { ok: false, message: error instanceof Error ? error.message : "Report could not be sent. Please try again." } })
    } finally {
      set({ pending: false })
    }
  },
}))
