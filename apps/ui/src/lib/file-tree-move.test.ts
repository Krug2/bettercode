import { describe, expect, it } from "vitest"
import { fileTreeMoveError, resolveFileTreeMove } from "./file-tree-move"
import { HttpError } from "./errors"

describe("file tree move destinations", () => {
  it("explains conflicts and denied moves without mislabeling other failures", () => {
    expect(fileTreeMoveError(new HttpError("workspace move failed", 409, "/workspace/move", { code: "EEXIST" }))).toContain("Nothing was replaced")
    expect(fileTreeMoveError(new HttpError("blocked", 403, "/workspace/move", { code: "workspace_untrusted" }))).toContain("Trust this workspace")
    expect(fileTreeMoveError(new HttpError("blocked", 403, "/workspace/move"))).toContain("read-only")
    expect(fileTreeMoveError(new Error("Connection lost"))).toBe("Connection lost")
  })
  it("moves files and folders between parents and back to the workspace root", () => {
    expect(resolveFileTreeMove("src/icons", "assets")).toEqual({
      fromRelativePath: "src/icons",
      toRelativePath: "assets/icons",
    })
    expect(resolveFileTreeMove("src/nested/readme.md", "src")).toEqual({
      fromRelativePath: "src/nested/readme.md",
      toRelativePath: "src/readme.md",
    })
    expect(resolveFileTreeMove("assets/icons", "")).toEqual({
      fromRelativePath: "assets/icons",
      toRelativePath: "icons",
    })
    expect(resolveFileTreeMove("src\\nested\\file.ts", "lib\\shared")).toEqual({
      fromRelativePath: "src/nested/file.ts",
      toRelativePath: "lib/shared/file.ts",
    })
  })

  it.each([
    ["src", "src"],
    ["src", "src/nested"],
    ["src", "SRC/nested"],
    ["src/a.ts", "src"],
    ["file.ts", ""],
    ["", "src"],
    ["../outside", "src"],
    ["src", "../outside"],
    ["/repo/src", "lib"],
    ["C:\\repo\\src", "lib"],
    ["src", "D:\\other"],
    ["src", "./lib"],
    ["src/../lib", "dest"],
    ["src", "lib//nested"],
  ])("rejects invalid or unchanged move %s → %s", (source, destination) => {
    expect(resolveFileTreeMove(source, destination)).toBeNull()
  })

  it("allows similarly named siblings", () => {
    expect(resolveFileTreeMove("src", "src-other")?.toRelativePath).toBe(
      "src-other/src"
    )
  })
})
