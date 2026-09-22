import type { CanvasPoint, CanvasRect } from "./project-canvas"

export type WorkspaceKind = "browser" | "usage" | "activity" | "note" | "chat"
export type WorkspacePanel = CanvasRect & { id: string; kind: WorkspaceKind; title: string; url: string; text: string }
export type WorkspaceCamera = { zoom: number; pan: CanvasPoint }

export const workspaceDefaults = {
  browser: { title: "Browser", width: 1000, height: 720 },
  usage: { title: "Usage blobs", width: 1000, height: 760 },
  activity: { title: "Usage charts", width: 1040, height: 700 },
  note: { title: "Note", width: 380, height: 320 },
  chat: { title: "Chat", width: 500, height: 740 },
} satisfies Record<WorkspaceKind, { title: string; width: number; height: number }>

export function workspaceUrl(value: string): string | null {
  const text = value.trim()
  if (!text || text.length > 8192) return null
  const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text)
  const hostWithPort = /^[a-z\d.-]+\.[a-z\d-]+:\d+(?:[/?#]|$)/i.test(text)
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^https?:/i.test(text) && !local && !hostWithPort) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `${local ? "http" : "https"}://${text}`)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function resizeWorkspacePanel(panel: CanvasRect, delta: CanvasPoint, zoom: number): CanvasRect {
  return { ...panel, width: Math.max(320, Math.min(2400, panel.width + delta.x / zoom)), height: Math.max(240, Math.min(1800, panel.height + delta.y / zoom)) }
}

export function restoreWorkspace(value: unknown): { panels: WorkspacePanel[]; camera: WorkspaceCamera | null } {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e6
  const seen = new Set<string>()
  const singles = new Set<string>()
  const panels = (Array.isArray(data.panels) ? data.panels : []).slice(0, 100).flatMap((item: unknown): WorkspacePanel[] => {
    if (!item || typeof item !== "object") return []
    const p = item as WorkspacePanel
    if (typeof p.id !== "string" || !p.id || seen.has(p.id) || !Object.hasOwn(workspaceDefaults, p.kind) || ![p.x, p.y, p.width, p.height].every(finite)) return []
    if (["usage", "activity", "chat"].includes(p.kind)) {
      if (singles.has(p.kind)) return []
      singles.add(p.kind)
    }
    seen.add(p.id)
    return [{ id: p.id, kind: p.kind, x: p.x, y: p.y, width: Math.max(320, Math.min(2400, p.width)), height: Math.max(240, Math.min(1800, p.height)), title: typeof p.title === "string" ? p.title.slice(0, 180) : workspaceDefaults[p.kind].title, url: typeof p.url === "string" ? workspaceUrl(p.url) ?? "" : "", text: typeof p.text === "string" ? p.text.slice(0, 100_000) : "" }]
  })
  const c = data.camera as WorkspaceCamera | undefined
  const camera = c && finite(c.zoom) && finite(c.pan?.x) && finite(c.pan?.y) ? { zoom: Math.max(0.1, Math.min(4, c.zoom)), pan: { x: c.pan.x, y: c.pan.y } } : null
  return { panels, camera }
}
