import { describe, expect, it } from "vitest"
import { compileBoundedGlob } from "./bounded-glob"

describe("bounded path glob matching", () => {
  it("agrees with the prior glob syntax across small pattern combinations", () => {
    const atoms = ["a", "*", "**", "**/", "/", "?", ".", "[x]"]
    const candidates = [
      "",
      "a",
      "ab",
      "a/b",
      "a//b",
      "a/a/b",
      "A.ts",
      "a\nb",
      "[x]",
      "x/a",
      "ſ",
      "S",
      "K",
      "k",
    ]
    for (const caseInsensitive of [false, true]) {
      for (const optionalGlobstarDirectory of [false, true]) {
        const options = { caseInsensitive, optionalGlobstarDirectory }
        for (const first of atoms)
          for (const second of atoms)
            for (const third of atoms) {
              const pattern = first + second + third
              // Keep this reference corpus small; only the new matcher receives
              // the adversarial overlapping-star input in the dedicated regression.
              let source = ""
              for (let index = 0; index < pattern.length; index += 1) {
                const character = pattern[index]!
                if (character === "*" && pattern[index + 1] === "*") {
                  index += 1
                  if (optionalGlobstarDirectory && pattern[index + 1] === "/") {
                    source += "(?:.*/)?"
                    index += 1
                  } else source += ".*"
                } else if (character === "*") source += "[^/]*"
                else if (character === "?") source += "[^/]"
                else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
              }
              const legacy = new RegExp(
                `^${source}$`,
                caseInsensitive ? "i" : ""
              )
              const matches = compileBoundedGlob(pattern, options)
              for (const candidate of candidates) {
                expect(
                  matches(candidate),
                  JSON.stringify({ pattern, candidate, options })
                ).toBe(legacy.test(candidate))
              }
            }
      }
    }
  })

  it.each([
    ["*.ts", "app.ts", true],
    ["*.ts", "src/app.ts", false],
    ["**/*.ts", "app.ts", true],
    ["**/*.ts", "src/deep/app.ts", true],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/deep/b", true],
    ["a/**/b", "a/deepb", false],
    ["a/**/b", "a//b", true],
    ["a?c", "abc", true],
    ["a?c", "a/c", false],
    ["[a].ts", "[a].ts", true],
    ["[a].ts", "a.ts", false],
    ["A.ts", "a.ts", false],
    ["*", "a\nb", true],
    ["**", "a\nb", false],
    ["a", "a\n", false],
    ["**/*", "file", true],
    ["**/*", "a/b", true],
  ] as const)("matches %s against %s", (pattern, candidate, expected) => {
    expect(compileBoundedGlob(pattern)(candidate)).toBe(expected)
  })

  it("preserves case and required-directory policies used by existing callers", () => {
    expect(
      compileBoundedGlob("*.TS", { caseInsensitive: true })("app.ts")
    ).toBe(true)
    expect(
      compileBoundedGlob("*.TS", { caseInsensitive: true })("app.ſs")
    ).toBe(false)
    const required = compileBoundedGlob("**/*.md", {
      optionalGlobstarDirectory: false,
    })
    expect(required("README.md")).toBe(false)
    expect(required("docs/README.md")).toBe(true)
  })

  it("finishes overlapping wildcard failures without backtracking", () => {
    const match = compileBoundedGlob("*a".repeat(16) + "b")
    expect(match("a".repeat(240))).toBe(false)
    expect(match("a".repeat(240) + "b")).toBe(true)
  })
})
