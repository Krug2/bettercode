import { describe, expect, it } from "vitest"
import { recordCssChange } from "./css-changes"

const original = {
  selector: "#card",
  property: "width",
  oldValue: "255px",
  newValue: "260px",
}
describe("preview style changes", () => {
  it("coalesces a drag into one edit while retaining the original value after reselection", () => {
    const changes = recordCssChange([], original)
    expect(
      recordCssChange(changes, {
        ...original,
        oldValue: "260px",
        newValue: "280px",
      })
    ).toEqual([{ ...original, newValue: "280px" }])
    expect(changes).toEqual([original])
  })
  it("removes a reverted edit while retaining other elements and properties", () => {
    const height = { ...original, property: "height" }
    const other = { ...original, selector: "#other" }
    expect(
      recordCssChange([original, height, other], {
        ...original,
        newValue: "255px",
      })
    ).toEqual([height, other])
    expect(recordCssChange([], { ...original, newValue: "255px" })).toEqual([])
  })
})
