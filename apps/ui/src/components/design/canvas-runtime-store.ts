import { create } from "zustand"
import type { ConsoleLog } from "@/components/browser-preview/types"
import {
  appendCapped,
  parsePreviewRequest,
  type PreviewRequestEntry,
} from "./canvas-runtime"

/**
 * What the runtime pane reads: the requests every preview guest made (keyed
 * by the guest's webContents id, which is how the shell identifies them) and
 * the console output each canvas viewport reported. Both are capped ring
 * buffers; a busy dev server would otherwise grow them without bound.
 */

export const MAX_REQUESTS_PER_GUEST = 300
export const MAX_CONSOLE_PER_VIEWPORT = 200

interface CanvasRuntimeStore {
  requestsByGuest: Record<number, PreviewRequestEntry[]>
  consoleByViewport: Record<string, ConsoleLog[]>
  recordRequest: (entry: PreviewRequestEntry) => void
  clearRequests: (guestIds: readonly number[]) => void
  recordConsole: (viewportKey: string, entries: readonly ConsoleLog[]) => void
  clearConsole: (viewportKeys: readonly string[]) => void
}

export const useCanvasRuntimeStore = create<CanvasRuntimeStore>((set) => ({
  requestsByGuest: {},
  consoleByViewport: {},
  recordRequest: (entry) =>
    set((state) => ({
      requestsByGuest: {
        ...state.requestsByGuest,
        [entry.webContentsId]: appendCapped(
          state.requestsByGuest[entry.webContentsId] ?? [],
          [entry],
          MAX_REQUESTS_PER_GUEST
        ),
      },
    })),
  clearRequests: (guestIds) =>
    set((state) => {
      const next = { ...state.requestsByGuest }
      for (const id of guestIds) delete next[id]
      return { requestsByGuest: next }
    }),
  recordConsole: (viewportKey, entries) =>
    set((state) => ({
      consoleByViewport: {
        ...state.consoleByViewport,
        [viewportKey]: appendCapped(
          state.consoleByViewport[viewportKey] ?? [],
          entries,
          MAX_CONSOLE_PER_VIEWPORT
        ),
      },
    })),
  clearConsole: (viewportKeys) =>
    set((state) => {
      const next = { ...state.consoleByViewport }
      for (const key of viewportKeys) delete next[key]
      return { consoleByViewport: next }
    }),
}))

let unsubscribe: (() => void) | null = null

/**
 * Subscribes once to the shell's request feed. Called by the first runtime
 * pane that mounts; outside Electron there is no feed and this is a no-op.
 */
export function ensurePreviewRequestFeed(): void {
  if (unsubscribe) return
  const api = typeof window === "undefined" ? undefined : window.electronAPI
  if (!api?.onPreviewRequest) return
  unsubscribe = api.onPreviewRequest((raw) => {
    const entry = parsePreviewRequest(raw)
    if (entry) useCanvasRuntimeStore.getState().recordRequest(entry)
  })
}

/** Test seam: drops the feed so a fresh subscription can be observed. */
export function resetPreviewRequestFeed(): void {
  unsubscribe?.()
  unsubscribe = null
}
