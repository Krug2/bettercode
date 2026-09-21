import { describe, expect, it } from "vitest"
import { replaceLiteralInContent } from "@/lib/workspace-replace"

describe("replaceLiteralInContent", () => {
  it("replaces literal text case-insensitively by default", () => {
    const result = replaceLiteralInContent(
      "Needle needle NEEDLE",
      "needle",
      "pin"
    )

    expect(result).toEqual({
      content: "pin pin pin",
      count: 3,
    })
  })

  it("preserves replacement characters without regex expansion", () => {
    const result = replaceLiteralInContent("a+b a+b", "a+b", "$value")

    expect(result).toEqual({
      content: "$value $value",
      count: 2,
    })
  })

  it("supports case-sensitive replace", () => {
    const result = replaceLiteralInContent("Needle needle", "needle", "pin", {
      caseSensitive: true,
    })

    expect(result).toEqual({
      content: "Needle pin",
      count: 1,
    })
  })

  it("supports whole-word replace", () => {
    const result = replaceLiteralInContent(
      "needle needles my_needle needleValue needle",
      "needle",
      "pin",
      { wholeWord: true }
    )

    expect(result).toEqual({
      content: "pin needles my_needle needleValue pin",
      count: 2,
    })
  })

  it("treats dollar signs and hyphens as whole-word identifier characters", () => {
    expect(
      replaceLiteralInContent("$store $storeValue $store", "$store", "state", {
        caseSensitive: true,
        wholeWord: true,
      })
    ).toEqual({
      content: "state $storeValue state",
      count: 2,
    })

    expect(
      replaceLiteralInContent(
        "panel-title panel-title-large panel-title",
        "panel-title",
        "section-title",
        {
          caseSensitive: true,
          wholeWord: true,
        }
      )
    ).toEqual({
      content: "section-title panel-title-large section-title",
      count: 2,
    })
  })

  it("can preserve match casing for literal replace", () => {
    const result = replaceLiteralInContent(
      "needle Needle NEEDLE",
      "needle",
      "pin",
      { preserveCase: true }
    )

    expect(result).toEqual({
      content: "pin Pin PIN",
      count: 3,
    })
  })

  it("supports regex replace with capture expansion", () => {
    const result = replaceLiteralInContent(
      "foo:12 bar:34",
      "(\\w+):(\\d+)",
      "$2-$1",
      {
        regex: true,
      }
    )

    expect(result).toEqual({
      content: "12-foo 34-bar",
      count: 2,
    })
  })

  it("supports whole-word regex replace", () => {
    const result = replaceLiteralInContent(
      "cat cater bobcat cat",
      "c.t",
      "dog",
      {
        regex: true,
        wholeWord: true,
      }
    )

    expect(result).toEqual({
      content: "dog cater bobcat dog",
      count: 2,
    })
  })

  it("can preserve match casing for regex replace", () => {
    const result = replaceLiteralInContent("foo Foo FOO", "f(o+)", "b$1r", {
      regex: true,
      preserveCase: true,
    })

    expect(result).toEqual({
      content: "boor Boor BOOR",
      count: 3,
    })
  })

  it("reports invalid regex replace queries", () => {
    expect(() =>
      replaceLiteralInContent("needle", "[", "pin", { regex: true })
    ).toThrow("Invalid replace regex")
  })
})
