import { describe, expect, it } from "vitest"
import { resolveFileTreeDropTarget } from "./file-tree-drop-target"

function target(path: string, offset: number, kind: "file" | "folder" = "folder") {
  return resolveFileTreeDropTarget({ path, kind, top: 100, height: 28, clientY: 100 + offset })
}

describe("file tree drop zones", () => {
  it.each([0, 4, 7])("makes the top edge easy to hit at %i px", (offset) => {
    expect(target("lib/assets", offset)).toEqual({
      directory: "lib", rowPath: "lib/assets", placement: "before",
    })
  })

  it.each([20, 24, 27])("makes the bottom edge easy to hit at %i px", (offset) => {
    expect(target("lib/assets", offset)).toEqual({
      directory: "lib", rowPath: "lib/assets", placement: "after",
    })
  })

  it.each([8, 14, 19])("keeps the folder center available at %i px", (offset) => {
    expect(target("lib/assets", offset)).toEqual({
      directory: "lib/assets", rowPath: "lib/assets", placement: "inside",
    })
  })

  it("allows returning to the root between top-level folders", () => {
    expect(target("assets", 4).directory).toBe("")
    expect(target("assets", 24).directory).toBe("")
  })

  it("normalizes Windows paths before finding the parent", () => {
    expect(target("lib\\assets", 4)).toEqual({
      directory: "lib", rowPath: "lib/assets", placement: "before",
    })
  })

  it.each([0, 13, 14, 27])("never treats a file as a directory at %i px", (offset) => {
    expect(target("lib/index.ts", offset, "file")).toEqual({
      directory: "lib", rowPath: "lib/index.ts", placement: offset < 14 ? "before" : "after",
    })
  })
})
