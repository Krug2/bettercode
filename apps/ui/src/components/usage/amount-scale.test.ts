import { describe, expect, it } from "vitest"
import { amountScale } from "./amount-scale"

describe("amount sizing", () => {
  it("gives the minimum one tenth of the maximum area and centers the median area", () => {
    const scale = amountScale([0, 3, 1_000_000])
    const smallest = scale(0).radius ** 2, largest = scale(1_000_000).radius ** 2
    expect(smallest / largest).toBeCloseTo(0.1, 12)
    expect(scale(3).radius ** 2).toBeCloseTo((smallest + largest) / 2, 8)
    expect(scale(3).intensity).toBe(0.5)
    expect(scale(1).radius).toBeGreaterThan(scale(0).radius)
    expect(scale(10).radius).toBeGreaterThan(scale(3).radius)
  })

  it("uses the middle pair for an even median and handles repeated extremes", () => {
    expect(amountScale([1, 3, 7, 100])(5).intensity).toBe(0.5)
    expect(amountScale([0, 0, 10])(0).intensity).toBe(0)
    expect(amountScale([0, 10, 10])(10).intensity).toBe(1)
    expect(amountScale([0, 10, 10])(5).intensity).toBe(0.25)
  })

  it("keeps missing amounts out of the scale and equal amounts the same size", () => {
    const scale = amountScale([null, 2, 4, 6, null])
    expect(scale(4).intensity).toBe(0.5)
    expect(scale(null).intensity).toBeNull()
    expect(amountScale([0, 0])(0).intensity).toBe(0.5)
    expect(amountScale([null])(null).radius).toBeGreaterThan(0)
    expect(amountScale([Number.NaN, Infinity, -1])(null).intensity).toBeNull()
  })
})
