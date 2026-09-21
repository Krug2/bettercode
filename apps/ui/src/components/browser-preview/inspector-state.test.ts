import { describe, expect, it } from "vitest"
import {
  EMPTY_INSPECTOR_STATE,
  cssChangesPrompt,
  highlightCommand,
  selectCommand,
  withDomTree,
  withPageChange,
  withSelectedElement,
  withStyleChange,
  withoutCssChanges,
  withoutSelection,
} from "./inspector-state"
import type { SelectedElement } from "./types"

const button: SelectedElement = {
  selector: "#buy",
  tagName: "button",
  id: "buy",
  className: "cta",
  text: "Buy",
  childCount: 0,
  styles: { color: "rgb(0, 0, 0)", padding: "8px" },
  rect: { x: 0, y: 0, w: 60, h: 24 },
}

describe("element inspector state", () => {
  it("shows a picked element's styles right away", () => {
    const state = withSelectedElement(EMPTY_INSPECTOR_STATE, button)
    expect(state.selected).toBe(button)
    expect(state.tab).toBe("styles")
    expect(state.editedStyles).toEqual(button.styles)
    expect(withoutSelection(state).selected).toBeNull()
  })

  it("turns a style edit into the page command and remembers the original value", () => {
    const picked = withSelectedElement(EMPTY_INSPECTOR_STATE, button)
    const first = withStyleChange(picked, "color", "red")
    expect(first.command).toEqual({
      type: "bc-apply-style",
      selector: "#buy",
      property: "color",
      value: "red",
    })
    expect(first.state.editedStyles.color).toBe("red")
    expect(first.state.cssChanges).toEqual([
      { selector: "#buy", property: "color", oldValue: "rgb(0, 0, 0)", newValue: "red" },
    ])
    // A second edit of the same property keeps the original, not "red".
    const second = withStyleChange(first.state, "color", "blue")
    expect(second.state.cssChanges).toEqual([
      { selector: "#buy", property: "color", oldValue: "rgb(0, 0, 0)", newValue: "blue" },
    ])
    // Reverting drops the change out of the batch entirely.
    const reverted = withStyleChange(second.state, "color", "rgb(0, 0, 0)")
    expect(reverted.state.cssChanges).toEqual([])
    expect(withoutCssChanges(second.state).cssChanges).toEqual([])
  })

  it("does nothing without a selection and keeps the identity of unchanged state", () => {
    const result = withStyleChange(EMPTY_INSPECTOR_STATE, "color", "red")
    expect(result.command).toBeNull()
    expect(result.state).toBe(EMPTY_INSPECTOR_STATE)
    expect(withDomTree(EMPTY_INSPECTOR_STATE, null)).toBe(EMPTY_INSPECTOR_STATE)
    expect(withoutSelection(EMPTY_INSPECTOR_STATE)).toBe(EMPTY_INSPECTOR_STATE)
  })

  it("forgets the tree and selection when the page changes, but not pending edits", () => {
    const picked = withSelectedElement(
      withDomTree(EMPTY_INSPECTOR_STATE, {
        tag: "body", id: "", classes: [], selector: "body", text: "", children: [],
      }),
      button
    )
    const edited = withStyleChange(picked, "padding", "12px").state
    const changed = withPageChange(edited)
    expect(changed.tree).toBeNull()
    expect(changed.selected).toBeNull()
    expect(changed.cssChanges).toHaveLength(1)
  })

  it("builds the page commands and the chat request", () => {
    expect(highlightCommand("#buy")).toEqual({ type: "bc-highlight", selector: "#buy" })
    expect(selectCommand("#buy")).toEqual({ type: "bc-select", selector: "#buy" })
    expect(
      cssChangesPrompt(
        [{ selector: "#buy", property: "color", oldValue: "black", newValue: "red" }],
        "http://localhost:5173/"
      )
    ).toBe(
      "Apply these visual changes to the codebase:\n\n- `#buy`: color: black -> red\n\nPage: http://localhost:5173/"
    )
  })
})
