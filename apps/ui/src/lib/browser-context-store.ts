import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { assignBrowserMentionNames } from "./browser-element-mentions"
import {
  browserElementKey,
  normalizeBrowserElement,
  type BrowserElementReference,
} from "@betterc0de/schema"

export const MAX_BROWSER_ELEMENTS = 16
export const EMPTY_BROWSER_ELEMENTS: readonly BrowserElementReference[] = []

interface BrowserContextState {
  byThread: Record<string, BrowserElementReference[]>
  add: (threadId: string, element: BrowserElementReference) => boolean
  remove: (threadId: string, key: string) => void
  ensureMentionNames: (threadId: string, draft: string) => readonly BrowserElementReference[]
  consume: (
    threadId: string,
    elements: readonly BrowserElementReference[]
  ) => void
}

export const useBrowserContextStore = create<BrowserContextState>()(
  persist(
    (set, get) => ({
      byThread: {},
      ensureMentionNames: (threadId, draft) => {
        const existing = get().byThread[threadId] ?? []
        if (existing.every(element => element.mentionName)) return existing
        const named = assignBrowserMentionNames(existing, draft)
        set(state => ({ byThread: { ...state.byThread, [threadId]: named } }))
        return named
      },
      add: (threadId, candidate) => {
        const element = normalizeBrowserElement(candidate)
        if (!threadId || !element) return false
        const existing = get().byThread[threadId] ?? []
        const key = browserElementKey(element)
        if (existing.some((item) => browserElementKey(item) === key))
          return true
        if (existing.length >= MAX_BROWSER_ELEMENTS) return false
        set((state) => ({
          byThread: { ...state.byThread, [threadId]: [...existing, element] },
        }))
        return true
      },
      remove: (threadId, key) =>
        set((state) => ({
          byThread: {
            ...state.byThread,
            [threadId]: (state.byThread[threadId] ?? []).filter(
              (item) => browserElementKey(item) !== key
            ),
          },
        })),
      consume: (threadId, elements) => {
        const keys = new Set(elements.map(browserElementKey))
        set((state) => ({
          byThread: {
            ...state.byThread,
            [threadId]: (state.byThread[threadId] ?? []).filter(
              (item) => !keys.has(browserElementKey(item))
            ),
          },
        }))
      },
    }),
    {
      name: "betterc0de-browser-context",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        byThread: Object.fromEntries(
          Object.entries(state.byThread)
            .filter(([, elements]) => elements.length)
            .slice(-50)
        ),
      }),
      merge: (persisted, current) => {
        const saved =
          (persisted as { byThread?: Record<string, unknown> } | null)
            ?.byThread ?? {}
        return {
          ...current,
          byThread: Object.fromEntries(
            Object.entries(saved)
              .slice(-50)
              .map(([id, elements]) => [
                id,
                Array.isArray(elements)
                  ? elements
                      .map(normalizeBrowserElement)
                      .filter(
                        (element): element is BrowserElementReference =>
                          element !== null
                      )
                      .slice(0, MAX_BROWSER_ELEMENTS)
                  : [],
              ])
          ),
        }
      },
    }
  )
)
