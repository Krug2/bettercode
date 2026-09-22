import { create } from "zustand"
import { persist } from "zustand/middleware"
import { restoreWorkspace, workspaceDefaults, workspaceUrl, type WorkspaceCamera, type WorkspaceKind, type WorkspacePanel } from "./canvas-workspace"
import type { CanvasPoint } from "./project-canvas"

interface WorkspaceState {
  panels: WorkspacePanel[]
  camera: WorkspaceCamera | null
  selected: string | null
  requested: { kind: WorkspaceKind; url?: string } | null
  focusRequest: { id: string } | null
  request: (kind: WorkspaceKind, url?: string) => void
  add: (kind: WorkspaceKind, point: CanvasPoint, url?: string) => string
  update: (id: string, patch: Partial<Omit<WorkspacePanel, "id" | "kind">>) => void
  remove: (id: string) => void
  raise: (id: string) => void
  focus: (id: string) => void
  saveCamera: (camera: WorkspaceCamera) => void
}

export const useCanvasWorkspaceStore = create<WorkspaceState>()(persist((set, get) => ({
  panels: [], camera: null, selected: null, requested: null, focusRequest: null,
  request: (kind, url) => set({ requested: { kind, url } }),
  add: (kind, point, value = "") => {
    const existing = ["usage", "activity", "chat"].includes(kind) ? get().panels.find(panel => panel.kind === kind) : undefined
    if (existing) { get().focus(existing.id); return existing.id }
    const id = crypto.randomUUID(), url = workspaceUrl(value) ?? ""
    const panel = { id, kind, ...point, ...workspaceDefaults[kind], url, text: "" }
    if (url) panel.title = new URL(url).hostname
    set(state => ({ panels: [...state.panels, panel], selected: id, focusRequest: { id } }))
    return id
  },
  update: (id, patch) => set(state => ({ panels: state.panels.map(panel => panel.id === id ? { ...panel, ...patch } : panel) })),
  remove: id => set(state => ({ panels: state.panels.filter(panel => panel.id !== id), selected: state.selected === id ? null : state.selected })),
  raise: id => set(state => {
    const panel = state.panels.find(panel => panel.id === id)
    return panel ? { selected: id, panels: state.panels.at(-1)?.id === id ? state.panels : [...state.panels.filter(panel => panel.id !== id), panel] } : {}
  }),
  focus: id => { get().raise(id); set({ focusRequest: { id } }) },
  saveCamera: camera => set({ camera }),
}), {
  name: "betterc0de.canvas-workspace", version: 1,
  partialize: ({ panels, camera }) => ({ panels, camera }),
  merge: (saved, current) => ({ ...current, ...restoreWorkspace(saved) }),
}))
