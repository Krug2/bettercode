import { describe, expect, it } from "vitest"
import {
  editorModelUri,
  editorPathAncestors,
  isAbsoluteEditorPath,
  isEditorPathEqualOrInside,
  normalizeEditorPath,
  rebaseEditorPath,
  relativeEditorPath,
  resolveWorkspaceFilePath,
  workspaceRelativeEditorPath,
} from "@/lib/editor-path"

describe("editor path helpers", () => {
  it("preserves platform paths as file URIs without interpreting filename punctuation", () => {
    expect(editorModelUri("C:\\repo\\a b#c?.ts")).toBe("file:///C:/repo/a%20b%23c%3F.ts")
    expect(editorModelUri("/repo/a.ts")).toBe("file:///repo/a.ts")
    expect(editorModelUri("/repo/a%20b.ts")).toBe("file:///repo/a%2520b.ts")
    expect(editorModelUri("\\\\server\\share\\a.ts")).toBe("file://server/share/a.ts")
  })
  it("normalizes Windows separators for display and matching", () => {
    expect(normalizeEditorPath("C:\\repo\\src\\main.ts")).toBe(
      "C:/repo/src/main.ts"
    )
  })

  it("returns a workspace-relative path for nested files", () => {
    expect(relativeEditorPath("/repo/app", "/repo/app/src/main.ts")).toBe(
      "src/main.ts"
    )
  })

  it("matches workspace prefixes case-insensitively", () => {
    expect(relativeEditorPath("/Repo/App", "/repo/app/src/main.ts")).toBe(
      "src/main.ts"
    )
  })

  it("falls back to the normalized absolute file path outside the workspace", () => {
    expect(relativeEditorPath("/repo/app", "/tmp/main.ts")).toBe("/tmp/main.ts")
  })

  it("returns the basename when the file is the workspace root", () => {
    expect(relativeEditorPath("/repo/app", "/repo/app")).toBe("app")
  })

  it("returns null for workspace-relative matching outside the workspace", () => {
    expect(workspaceRelativeEditorPath("/repo/app", "/tmp/main.ts")).toBeNull()
  })

  it("returns an empty relative path when matching the workspace root exactly", () => {
    expect(workspaceRelativeEditorPath("/repo/app", "/repo/app")).toBe("")
  })

  it("detects Unix, Windows, and UNC absolute paths", () => {
    expect(isAbsoluteEditorPath("/repo/app/src/main.ts")).toBe(true)
    expect(isAbsoluteEditorPath("C:\\repo\\src\\main.ts")).toBe(true)
    expect(isAbsoluteEditorPath("\\\\server\\share\\main.ts")).toBe(true)
    expect(isAbsoluteEditorPath("src/main.ts")).toBe(false)
  })

  it("resolves workspace-relative file paths against the project root", () => {
    expect(resolveWorkspaceFilePath("/repo/app", "src/main.ts")).toBe(
      "/repo/app/src/main.ts"
    )
  })

  it("does not mix separators when resolving nested Windows paths", () => {
    expect(
      resolveWorkspaceFilePath("C:\\repo\\app", "src/components/main.ts")
    ).toBe("C:\\repo\\app\\src\\components\\main.ts")
  })

  it("keeps absolute paths unchanged when resolving workspace paths", () => {
    expect(resolveWorkspaceFilePath("/repo/app", "/tmp/main.ts")).toBe(
      "/tmp/main.ts"
    )
  })

  it("returns parent folder paths for expanding tree ancestors", () => {
    expect(editorPathAncestors("src/components/editor/index.tsx")).toEqual([
      "src",
      "src/components",
      "src/components/editor",
    ])
  })

  it("matches exact paths and descendants without matching sibling prefixes", () => {
    expect(isEditorPathEqualOrInside("/repo/src/a.ts", "/repo/src")).toBe(true)
    expect(isEditorPathEqualOrInside("/repo/src", "/repo/src")).toBe(true)
    expect(isEditorPathEqualOrInside("/repo/src-old/a.ts", "/repo/src")).toBe(
      false
    )
  })

  it("rebases paths under a moved file or folder", () => {
    expect(
      rebaseEditorPath(
        "/repo/src/components/button.tsx",
        "/repo/src",
        "/repo/app"
      )
    ).toBe("/repo/app/components/button.tsx")
    expect(rebaseEditorPath("/repo/src/a.ts", "/repo/src/a.ts", "/repo/b.ts"))
      .toBe("/repo/b.ts")
    expect(rebaseEditorPath("/repo/other.ts", "/repo/src", "/repo/app")).toBe(
      null
    )
  })
})
