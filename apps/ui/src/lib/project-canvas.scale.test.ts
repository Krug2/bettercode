import { describe, expect, it } from "vitest"
import type { ThreadSettings } from "./chat/types"
import {
  CARD_SCALE_MAX,
  CARD_SCALE_MIN,
  RUNTIME_PANE_WIDTH,
  canvasCardScale,
  canvasProjectLayout,
  canvasProjectSize,
  resizeCardScale,
} from "./project-canvas"

describe("card scale", () => {
  it("defaults to 1 and clamps stored values to the range", () => {
    expect(canvasCardScale()).toBe(1)
    expect(canvasCardScale({})).toBe(1)
    expect(canvasCardScale({ designCardScale: Number.NaN })).toBe(1)
    expect(canvasCardScale({ designCardScale: 0.1 })).toBe(CARD_SCALE_MIN)
    expect(canvasCardScale({ designCardScale: 9 })).toBe(CARD_SCALE_MAX)
    expect(canvasCardScale({ designCardScale: 1.5 })).toBe(1.5)
  })

  it.each([0.25, 0.5, 1, 1.5, 2])(
    "scales the entire card, including chrome and runtime, by %s",
    (scale) => {
      for (const settings of [
        {},
        { designDevicePreset: "mobile" },
        { designDevicePresets: ["desktop", "mobile"], designRuntimePane: true },
      ] satisfies ThreadSettings[]) {
        const base = canvasProjectSize(settings)
        const scaledSettings = { ...settings, designCardScale: scale }
        expect(canvasProjectSize(scaledSettings)).toEqual({
          width: base.width * scale,
          height: base.height * scale,
        })
        // Scaling changes the occupied stage bounds, not the internal layout.
        expect(canvasProjectLayout(scaledSettings)).toEqual(
          canvasProjectLayout(settings)
        )
      }
    }
  )

  it("widens the card by the runtime pane, which follows the card scale but not the half-size preview", () => {
    const base = canvasProjectSize()
    const withPane = canvasProjectSize({ designRuntimePane: true })
    expect(canvasProjectLayout().runtimePaneWidth).toBe(0)
    expect(
      canvasProjectLayout({ designRuntimePane: true }).runtimePaneWidth
    ).toBe(RUNTIME_PANE_WIDTH)
    // Pane plus the gap that separates it from the last device.
    expect(withPane.width - base.width).toBe(RUNTIME_PANE_WIDTH + 16)
    expect(withPane.height).toBe(base.height)
  })

  it("turns a corner drag into a proportional scale in stage pixels", () => {
    // 720px wide card, dragged 180 screen px at 200% zoom = 90 stage px.
    expect(
      resizeCardScale({ startScale: 1, startWidth: 720, deltaX: 180, zoom: 2 })
    ).toBe(1.13)
    expect(
      resizeCardScale({ startScale: 1, startWidth: 720, deltaX: -360, zoom: 1 })
    ).toBe(0.5)
    expect(
      resizeCardScale({
        startScale: 1,
        startWidth: 720,
        deltaX: -9999,
        zoom: 1,
      })
    ).toBe(CARD_SCALE_MIN)
    expect(
      resizeCardScale({
        startScale: 1.5,
        startWidth: 720,
        deltaX: 9999,
        zoom: 1,
      })
    ).toBe(CARD_SCALE_MAX)
  })

  it.each([0.5, 1, 2])(
    "keeps corner resizing proportional at canvas zoom %s",
    (zoom) => {
      const settings = { designCardScale: 0.5, designRuntimePane: true }
      const before = canvasProjectSize(settings)
      const next = resizeCardScale({
        startScale: 0.5,
        startWidth: before.width,
        deltaX: before.width * zoom,
        zoom,
      })
      const after = canvasProjectSize({ ...settings, designCardScale: next })
      expect(next).toBe(1)
      expect(after.width).toBe(before.width * 2)
      expect(after.height).toBe(before.height * 2)
    }
  )
})
