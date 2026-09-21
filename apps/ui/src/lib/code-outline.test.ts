import { describe, expect, it } from "vitest"
import { buildCodeOutline, selectCurrentOutlinePath } from "@/lib/code-outline"

describe("buildCodeOutline", () => {
  it("extracts TypeScript classes, components, functions, types, and methods", () => {
    const outline = buildCodeOutline({
      language: "typescript",
      content: [
        "export interface User { id: string }",
        "type Result = { ok: boolean }",
        "export function loadUser(id: string) {",
        "  return id",
        "}",
        "export const UserCard = ({ user }) => {",
        "  return null",
        "}",
        "class Store {",
        "  save(value: string) {",
        "  }",
        "}",
      ].join("\n"),
    })

    expect(outline.map((item) => [item.kind, item.name, item.line])).toEqual([
      ["interface", "User", 1],
      ["type", "Result", 2],
      ["function", "loadUser", 3],
      ["component", "UserCard", 6],
      ["class", "Store", 9],
      ["method", "save", 10],
    ])
  })

  it("extracts markdown headings with nested depth", () => {
    const outline = buildCodeOutline({
      language: "markdown",
      content: "# Intro\n\n## Install\n### CLI",
    })

    expect(outline.map((item) => [item.name, item.depth, item.line])).toEqual([
      ["Intro", 0, 1],
      ["Install", 1, 3],
      ["CLI", 2, 4],
    ])
  })

  it("extracts Python classes and functions", () => {
    const outline = buildCodeOutline({
      language: "python",
      content: "class Runner:\n    async def start(self):\n        pass\n",
    })

    expect(outline.map((item) => [item.kind, item.name, item.depth])).toEqual([
      ["class", "Runner", 0],
      ["function", "start", 2],
    ])
  })

  it("selects the current nested symbol path from cursor line", () => {
    const outline = buildCodeOutline({
      language: "typescript",
      content: [
        "export function loadUser(id: string) {",
        "  return id",
        "}",
        "",
        "class Store {",
        "  save(value: string) {",
        "    return value",
        "  }",
        "}",
      ].join("\n"),
    })

    expect(
      selectCurrentOutlinePath(outline, 2).map((item) => item.name)
    ).toEqual(["loadUser"])
    expect(
      selectCurrentOutlinePath(outline, 7).map((item) => item.name)
    ).toEqual(["Store", "save"])
  })

  it("keeps markdown heading ancestry for breadcrumbs", () => {
    const outline = buildCodeOutline({
      language: "markdown",
      content: "# Intro\n\n## Install\n\n### CLI\nsteps",
    })

    expect(
      selectCurrentOutlinePath(outline, 6).map((item) => item.name)
    ).toEqual(["Intro", "Install", "CLI"])
  })
})
