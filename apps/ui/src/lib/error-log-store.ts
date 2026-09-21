import { create } from "zustand"

export type ErrorLogLevel = "error" | "warn" | "unhandledrejection" | "boundary"

export interface ErrorLogEntry {
  id: string
  timestamp: number
  level: ErrorLogLevel
  message: string
  stack?: string
  componentStack?: string
  source?: string
}

interface ErrorLogState {
  entries: ErrorLogEntry[]
  push: (entry: Omit<ErrorLogEntry, "id" | "timestamp">) => void
  clear: () => void
  copyAll: () => string
}

const STORAGE_KEY = "betterc0de.errorlog.v1"
const MAX_ENTRIES = 100
const MAX_STORAGE_BYTES = 50_000

function loadPersisted(): ErrorLogEntry[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : []
  } catch {
    return []
  }
}

function persist(entries: ErrorLogEntry[]) {
  if (typeof localStorage === "undefined") return
  try {
    let payload = JSON.stringify(entries)
    // Shed oldest entries until under the storage cap so the ring never blows localStorage.
    let trimmed = entries
    while (payload.length > MAX_STORAGE_BYTES && trimmed.length > 1) {
      trimmed = trimmed.slice(Math.ceil(trimmed.length / 2))
      payload = JSON.stringify(trimmed)
    }
    localStorage.setItem(STORAGE_KEY, payload)
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useErrorLogStore = create<ErrorLogState>((set, get) => ({
  entries: loadPersisted(),
  push: (entry) => {
    const next: ErrorLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    }
    set((state) => {
      const entries = [...state.entries, next].slice(-MAX_ENTRIES)
      persist(entries)
      return { entries }
    })
  },
  clear: () => {
    set({ entries: [] })
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
  },
  copyAll: () => {
    const entries = get().entries
    return entries
      .map((e) => {
        const ts = new Date(e.timestamp).toISOString()
        const head = `[${ts}] [${e.level}] ${e.message}`
        const bits = [head]
        if (e.source) bits.push(`  source: ${e.source}`)
        if (e.componentStack) bits.push(`  component stack: ${e.componentStack.trim()}`)
        if (e.stack) bits.push(`  stack: ${e.stack.trim()}`)
        return bits.join("\n")
      })
      .join("\n\n")
  },
}))

export function logToErrorStore(entry: Omit<ErrorLogEntry, "id" | "timestamp">) {
  useErrorLogStore.getState().push(entry)
}
