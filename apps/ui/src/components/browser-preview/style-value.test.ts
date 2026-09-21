import { describe, expect, it } from "vitest"
import {
  adjustStyleNumber,
  cssStyleValue,
  displayStyleValue,
  parseStyleNumber,
  styleStep,
} from "./style-value"

describe("style numeric editing", () => {
  it.each([
    "auto",
    "normal",
    "calc(100% - 2px)",
    "1px 2px",
    "",
    "Infinity",
    "#123",
  ])("does not scrub %s into a pixel value", (value) => {
    expect(parseStyleNumber(value)).toBeNull()
    expect(adjustStyleNumber(value, 10)).toBeNull()
  })
  it("preserves CSS units and decimal precision", () => {
    expect(adjustStyleNumber("24px", 1)).toBe("25px")
    expect(adjustStyleNumber("50%", -10)).toBe("40%")
    expect(adjustStyleNumber("1.2rem", 0.1)).toBe("1.3rem")
    expect(adjustStyleNumber("-8", 0.1)).toBe("-7.9")
  })
  it("bounds sizes and opacity while allowing negative margins", () => {
    expect(adjustStyleNumber("5", -10, 0)).toBe("0")
    expect(adjustStyleNumber("99%", 10, 0, 100)).toBe("100%")
    expect(adjustStyleNumber("0px", -10)).toBe("-10px")
  })
  it("adds only the default unit and never overwrites explicit units or keywords", () => {
    expect(cssStyleValue("24", "px")).toBe("24px")
    expect(cssStyleValue(" 50% ", "px")).toBe("50%")
    expect(cssStyleValue("auto", "px")).toBe("auto")
    expect(cssStyleValue("", "px")).toBe("")
    expect(displayStyleValue("24px", "px")).toBe("24")
    expect(displayStyleValue("2rem", "px")).toBe("2rem")
    expect(displayStyleValue("100%", "%")).toBe("100")
  })
  it("uses fine, ordinary and Shift steps without rescaling previous motion", () => {
    let value = adjustStyleNumber("100px", 5 * styleStep(false, false))!
    value = adjustStyleNumber(value, 2 * styleStep(true, false))!
    value = adjustStyleNumber(value, -1 * styleStep(false, true))!
    expect(value).toBe("124.9px")
  })
})
