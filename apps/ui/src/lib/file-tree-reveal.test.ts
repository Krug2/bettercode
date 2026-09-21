import { describe, expect, it } from "vitest"
import { resolveFileTreeRevealTarget } from "@/lib/file-tree-reveal"

describe("resolveFileTreeRevealTarget", () => {
  it("returns a workspace-relative reveal path and ancestors", () => {
    expect(
      resolveFileTreeRevealTarget(
        "/repo/app",
        "/repo/app/src/components/editor.tsx"
      )
    ).toEqual({
      relativePath: "src/components/editor.tsx",
      ancestorPaths: ["src", "src/components"],
    })
  })

  it("normalizes relative Windows paths", () => {
    expect(
      resolveFileTreeRevealTarget("/repo/app", "src\\file-tree\\node.tsx")
    ).toEqual({
      relativePath: "src/file-tree/node.tsx",
      ancestorPaths: ["src", "src/file-tree"],
    })
  })

  it("ignores absolute paths outside the workspace", () => {
    expect(
      resolveFileTreeRevealTarget("/repo/app", "/tmp/outside.ts")
    ).toBeNull()
  })

  it("ignores the workspace root because there is no file row to reveal", () => {
    expect(resolveFileTreeRevealTarget("/repo/app", "/repo/app")).toBeNull()
  })
})
