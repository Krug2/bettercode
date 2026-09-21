import { describe, expect, it } from "vitest"
import {
  applyBetterC0deInputShortcut,
  resolveBetterC0deInputShortcut,
  type TextInputSnapshot,
} from "@/lib/betterc0de-input-keybindings"

const input = (
  value: string,
  selectionStart = value.length,
  selectionEnd = selectionStart
): TextInputSnapshot => ({ value, selectionStart, selectionEnd })

describe("BetterC0de composer input keybindings", () => {
  it("maps BetterC0de newline shortcuts to newline insertion", () => {
    for (const event of [
      { key: "Enter", shiftKey: true },
      { key: "Enter", ctrlKey: true },
      { key: "Enter", altKey: true },
      { key: "j", ctrlKey: true },
    ]) {
      expect(resolveBetterC0deInputShortcut(event, input("ab", 1))).toBe(
        "newline"
      )
      expect(
        applyBetterC0deInputShortcut(input("ab", 1), "newline")
      ).toMatchObject({
        value: "a\nb",
        selectionStart: 2,
        selectionEnd: 2,
      })
    }
  })

  it("leaves plain Enter available for submit handling", () => {
    expect(resolveBetterC0deInputShortcut({ key: "Enter" }, input("ask"))).toBe(
      null
    )
  })

  it("clears the prompt with ctrl+c only when nothing is selected", () => {
    expect(
      resolveBetterC0deInputShortcut({ key: "c", ctrlKey: true }, input("ask"))
    ).toBe("clear")
    expect(
      resolveBetterC0deInputShortcut(
        { key: "c", ctrlKey: true },
        input("ask", 0, 3)
      )
    ).toBe(null)
    expect(applyBetterC0deInputShortcut(input("ask"), "clear")).toMatchObject({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
    })
  })

  it("supports BetterC0de line deletion shortcuts", () => {
    expect(
      applyBetterC0deInputShortcut(input("one\ntwo\nthree", 5), "delete-line")
    ).toMatchObject({
      value: "one\nthree",
      selectionStart: 4,
      selectionEnd: 4,
    })
    expect(
      applyBetterC0deInputShortcut(
        input("one\ntwo\nthree", 5),
        "delete-to-line-start"
      )
    ).toMatchObject({
      value: "one\nwo\nthree",
      selectionStart: 4,
      selectionEnd: 4,
    })
    expect(
      applyBetterC0deInputShortcut(
        input("one\ntwo\nthree", 5),
        "delete-to-line-end"
      )
    ).toMatchObject({
      value: "one\nt\nthree",
      selectionStart: 5,
      selectionEnd: 5,
    })
  })

  it("supports ctrl+d forward delete without swallowing selected text behavior", () => {
    expect(
      applyBetterC0deInputShortcut(input("abcd", 1), "delete-character")
    ).toMatchObject({
      value: "acd",
      selectionStart: 1,
      selectionEnd: 1,
    })
    expect(
      applyBetterC0deInputShortcut(input("abcd", 1, 3), "delete-character")
    ).toMatchObject({
      value: "ad",
      selectionStart: 1,
      selectionEnd: 1,
    })
  })
})
