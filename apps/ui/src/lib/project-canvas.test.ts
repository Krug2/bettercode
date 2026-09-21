import { describe, expect, it } from "vitest"
import {
  canvasBounds,
  canvasDevices,
  canvasProjectSize,
  moveOnCanvas,
  nextCanvasPosition,
  readCanvasPlacements,
  screenToCanvas,
} from "./project-canvas"

describe("shared project canvas geometry", () => {
  it("restores only distinct, finite project positions", () => {
    expect(
      readCanvasPlacements(
        JSON.stringify([
          { threadId: "a", x: -400, y: 50 },
          { threadId: "a", x: 2, y: 3 },
          { threadId: "b", x: "50", y: 0 },
          { threadId: "c", x: 1e20, y: 0 },
          null,
        ])
      )
    ).toEqual([{ threadId: "a", x: -400, y: 50 }])
    expect(readCanvasPlacements("not json")).toEqual([])
    expect(readCanvasPlacements("{}")).toEqual([])
  })
  it("keeps legacy devices and falls back from an empty selection", () => {
    expect(
      canvasDevices({ designDevicePreset: "tablet" }).map((device) => device.id)
    ).toEqual(["tablet"])
    expect(
      canvasDevices({ designDevicePresets: [] }).map((device) => device.id)
    ).toEqual(["desktop"])
    expect(
      canvasDevices({
        designDevicePresets: ["mobile", "desktop", "mobile"],
      }).map((device) => device.id)
    ).toEqual(["desktop", "mobile"])
  })
  it("remembers that a frame was removed without forgetting its position", () => {
    expect(
      readCanvasPlacements('[{"threadId":"a","x":200,"y":-100,"hidden":true}]')
    ).toEqual([{ threadId: "a", x: 200, y: -100, hidden: true }])
  })
  it("fits frames above and left of the origin without clipping them", () => {
    const rects = [
      { x: -200, y: -100, width: 300, height: 250 },
      { x: 300, y: 200, width: 100, height: 100 },
    ]
    expect(canvasBounds(rects)).toEqual({
      x: -200,
      y: -100,
      width: 600,
      height: 400,
    })
    expect(nextCanvasPosition(rects)).toEqual({ x: 464, y: -100 })
  })
  it("converts right clicks and drags through the same zoom and pan", () => {
    expect(
      screenToCanvas(
        { x: 500, y: 400 },
        { x: 100, y: 50 },
        { x: 200, y: 100 },
        0.5
      )
    ).toEqual({ x: 400, y: 500 })
    expect(moveOnCanvas({ x: -30, y: 20 }, { x: 60, y: -10 }, 0.5)).toEqual({
      x: 90,
      y: 0,
    })
  })
  it("expands the project frame for simultaneous device previews", () => {
    const single = canvasProjectSize()
    const multiple = canvasProjectSize({
      designDevicePresets: ["desktop", "tablet", "mobile"],
    })
    expect(multiple.width).toBeGreaterThan(single.width)
    expect(multiple.height).toBeGreaterThan(single.height)
    expect(single.width).toBe(752)
    expect(single.height).toBe(762)
  })
})
