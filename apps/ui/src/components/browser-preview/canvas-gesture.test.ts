import { describe, expect, it } from "vitest"
import { readCanvasWheel } from "./canvas-gesture"

describe("guest wheel boundary", () => {
  it("accepts finite normalized positions and bounds the wheel impulse", () => {
    expect(readCanvasWheel({ x: 0.25, y: 0.7, deltaY: -120 })).toEqual({ x: 0.25, y: 0.7, deltaY: -120 })
    expect(readCanvasWheel({ x: 1, y: 0, deltaY: 9000 })?.deltaY).toBe(1000)
  })
  it("ignores malformed or out-of-viewport messages", () => {
    for (const input of [null, [], "wheel", { x: "0", y: 0, deltaY: 20 }, { x: -1, y: 0, deltaY: 20 }, { x: 0, y: 2, deltaY: 20 }, { x: 0, y: 0, deltaY: NaN }]) {
      expect(readCanvasWheel(input)).toBeNull()
    }
  })
})
