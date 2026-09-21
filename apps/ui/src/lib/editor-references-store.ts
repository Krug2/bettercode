import { create } from "zustand"

export interface EditorReferenceRequest {
  symbol: string
  originFilePath: string
  originLine: number
  originColumn: number
  requestedAt: number
}

interface EditorReferencesState {
  request: EditorReferenceRequest | null
  setReferenceRequest: (
    request: Omit<EditorReferenceRequest, "requestedAt"> & {
      requestedAt?: number
    }
  ) => void
  clearReferenceRequest: () => void
}

export const useEditorReferencesStore = create<EditorReferencesState>(
  (set) => ({
    request: null,
    setReferenceRequest: (request) =>
      set({
        request: {
          ...request,
          symbol: request.symbol.trim(),
          originFilePath: normalizePath(request.originFilePath),
          requestedAt: request.requestedAt ?? Date.now(),
        },
      }),
    clearReferenceRequest: () => set({ request: null }),
  })
)

export function isReferenceSearchableSymbol(value: string | null | undefined) {
  return /^[A-Za-z_$][\w$-]*$/.test(value?.trim() ?? "")
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/")
}
