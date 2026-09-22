import { describe, expect, it } from "vitest"
import { zoomCamera } from "./graph-camera"

describe("graph zoom", () => {
  const camera = { x: 70, y: -30, zoom: 0.8 }, anchor = { x: -120, y: 160 }
  it("keeps the world point under the pointer fixed while zooming", () => {
    const world = { x: (anchor.x - camera.x) / camera.zoom, y: (anchor.y - camera.y) / camera.zoom }
    for (const target of [0.1, 0.5, 1.2, 4]) {
      const next = zoomCamera(camera, target, anchor)
      expect(world.x * next.zoom + next.x).toBeCloseTo(anchor.x, 10)
      expect(world.y * next.zoom + next.y).toBeCloseTo(anchor.y, 10)
      expect(next.zoom).toBeGreaterThanOrEqual(0.25)
      expect(next.zoom).toBeLessThanOrEqual(2)
    }
  })
  it("reverses zoom without drifting and supports centered controls", () => {
    expect(zoomCamera(zoomCamera(camera, 1.6, anchor), camera.zoom, anchor)).toEqual(camera)
    expect(zoomCamera(camera, 1.6)).toEqual({ x: 140, y: -60, zoom: 1.6 })
  })
})
