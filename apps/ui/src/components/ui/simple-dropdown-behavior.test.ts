import { describe, expect, it } from "vitest"
import {
  shouldCloseOnOtherSubOpen,
  shouldCloseOnPointerDown,
} from "@/components/ui/simple-dropdown-behavior"

describe("shouldCloseOnOtherSubOpen", () => {
  it("closes when a sibling sub-menu opens", () => {
    expect(
      shouldCloseOnOtherSubOpen("sub-1", {
        openerId: "sub-2",
        openerIsDescendant: false,
      })
    ).toBe(true)
  })

  // Regression: the model picker nests Model › provider › model. Closing on
  // ANY other sub opening meant clicking a provider collapsed the menu that
  // was hosting it, so the model list never appeared.
  it("stays open when one of its own descendants opens", () => {
    expect(
      shouldCloseOnOtherSubOpen("model-row", {
        openerId: "provider-row",
        openerIsDescendant: true,
      })
    ).toBe(false)
  })

  it("ignores its own broadcast", () => {
    expect(
      shouldCloseOnOtherSubOpen("sub-1", {
        openerId: "sub-1",
        openerIsDescendant: false,
      })
    ).toBe(false)
  })

  it("ignores a broadcast with no opener", () => {
    expect(
      shouldCloseOnOtherSubOpen("sub-1", {
        openerId: undefined,
        openerIsDescendant: false,
      })
    ).toBe(false)
  })
})

describe("shouldCloseOnPointerDown", () => {
  it("closes on a click outside every dropdown surface", () => {
    expect(
      shouldCloseOnPointerDown({
        insideOwnTrigger: false,
        insideOwnPanel: false,
        insideAnyDropdownPanel: false,
      })
    ).toBe(true)
  })

  it("stays open for clicks on its own trigger or panel", () => {
    expect(
      shouldCloseOnPointerDown({
        insideOwnTrigger: true,
        insideOwnPanel: false,
        insideAnyDropdownPanel: false,
      })
    ).toBe(false)
    expect(
      shouldCloseOnPointerDown({
        insideOwnTrigger: false,
        insideOwnPanel: true,
        insideAnyDropdownPanel: true,
      })
    ).toBe(false)
  })

  // Regression: descendant panels are portaled to <body>, so picking a model
  // is not DOM-contained in the provider menu that owns it. Treating that as
  // an outside click closed the menu on pointerdown and unmounted the item
  // before its click could fire — the selection silently did nothing.
  it("stays open for a click inside a portaled descendant panel", () => {
    expect(
      shouldCloseOnPointerDown({
        insideOwnTrigger: false,
        insideOwnPanel: false,
        insideAnyDropdownPanel: true,
      })
    ).toBe(false)
  })
})
