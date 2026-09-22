import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Point } from "./graph-data"

export interface UsageLayout {
  expanded: string[]
  positions: Record<string, Point>
  colors: Record<string, number>
  camera: Point & { zoom: number }
}

interface UsageGraphState extends UsageLayout {
  toggle: (id: string) => void
  expand: (ids: string[]) => void
  position: (id: string, point: Point) => void
  colorize: (ids: string[]) => void
  setCamera: (camera: UsageLayout["camera"]) => void
  reset: () => void
}

const initial = { expanded: [], positions: {}, colors: {}, camera: { x: 0, y: 0, zoom: 1 } }

export const useUsageGraphStore = create<UsageGraphState>()(persist((set, get) => ({
  ...initial,
  toggle: id => set(state => ({ expanded: state.expanded.includes(id) ? state.expanded.filter(value => value !== id) : [...state.expanded, id] })),
  expand: expanded => set({ expanded }),
  position: (id, point) => set(state => ({ positions: { ...state.positions, [id]: point } })),
  setCamera: camera => set({ camera }),
  reset: () => set({ positions: {}, camera: initial.camera }),
  colorize: ids => {
    const colors = { ...get().colors }
    let changed = false
    for (const id of ids) {
      if (Object.hasOwn(colors, id)) continue
      let hue = Math.floor(Math.random() * 360)
      for (let tries = 0; tries < 20 && Object.values(colors).some(value => Math.min(Math.abs(value - hue), 360 - Math.abs(value - hue)) < 30); tries++) hue = Math.floor(Math.random() * 360)
      colors[id] = hue
      changed = true
    }
    if (changed) set({ colors })
  },
}), {
  name: "betterc0de.usage-layout",
  version: 1,
  partialize: ({ expanded, positions, colors, camera }) => ({ expanded, positions, colors, camera }),
  merge: (saved, current) => ({ ...current, ...restoreLayout(saved) }),
}))

export function restoreLayout(value: unknown): Partial<UsageLayout> {
  if (!value || typeof value !== "object") return {}
  const data = value as Partial<UsageLayout>
  const point = (p: unknown): p is Point => !!p && typeof p === "object" && ["x", "y"].every(key => typeof (p as Record<string, unknown>)[key] === "number" && Number.isFinite((p as Record<string, number>)[key]) && Math.abs((p as Record<string, number>)[key]) < 1e6)
  const positions = Object.fromEntries(Object.entries(data.positions ?? {}).filter(([, p]) => point(p)))
  const colors = Object.fromEntries(Object.entries(data.colors ?? {}).filter(([, hue]) => typeof hue === "number" && hue >= 0 && hue < 360))
  return {
    expanded: Array.isArray(data.expanded) ? data.expanded.filter(id => typeof id === "string").slice(0, 10_000) : [],
    positions, colors,
    camera: point(data.camera) && typeof data.camera.zoom === "number" && Number.isFinite(data.camera.zoom) ? { ...data.camera, zoom: Math.max(0.25, Math.min(2, data.camera.zoom)) } : initial.camera,
  }
}
