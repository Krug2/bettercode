import { beforeEach, expect, it } from "vitest"
import { useCanvasWorkspaceStore as store } from "./canvas-workspace-store"

beforeEach(() => store.setState({ panels: [], camera: null, selected: null, requested: null, focusRequest: null }))

it("keeps browser windows independent and brings a selected window forward", () => {
  const a = store.getState().add("browser", { x: 0, y: 0 }, "github.com")
  const b = store.getState().add("browser", { x: 1200, y: -30 }, "example.com")
  store.getState().update(a, { x: -40, width: 820 })
  store.getState().focus(a)
  expect(store.getState().panels.map(panel => panel.id)).toEqual([b, a])
  expect(store.getState().panels[0]).toMatchObject({ x: 1200, y: -30, url: "https://example.com/" })
  expect(store.getState().panels[1]).toMatchObject({ x: -40, width: 820 })
  store.getState().remove(a)
  expect(store.getState().panels.map(panel => panel.id)).toEqual([b])
})

it("reuses the live usage window instead of mounting competing graph stores", () => {
  const id = store.getState().add("usage", { x: 100, y: 50 })
  expect(store.getState().add("usage", { x: 500, y: 900 })).toBe(id)
  expect(store.getState().panels).toHaveLength(1)
  expect(store.getState().focusRequest?.id).toBe(id)
})
