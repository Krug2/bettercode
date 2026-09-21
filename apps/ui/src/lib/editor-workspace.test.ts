import { describe, expect, it } from "vitest"
import {
  editorWorkspaceKey,
  selectEditorWorkspaceThread,
} from "./editor-workspace"

describe("editor workspace restoration", () => {
  const threads = [
    { id: "scratch", projectPath: null },
    { id: "latest", projectPath: "C:\\work\\new" },
    { id: "remembered", projectPath: "C:\\work\\project" },
    {
      id: "worktree",
      projectPath: "C:\\work\\project",
      worktreePath: "C:\\worktrees\\feature",
    },
  ]
  it("reopens the remembered Windows workspace across separator and case differences", () => {
    expect(selectEditorWorkspaceThread(threads, "c:/WORK/project/")?.id).toBe(
      "remembered"
    )
  })
  it("keeps worktrees distinct from their repository", () => {
    expect(
      selectEditorWorkspaceThread(threads, "C:/worktrees/feature")?.id
    ).toBe("worktree")
  })
  it("restores the selected conversation instead of the first chat in the workspace", () => {
    const sameWorkspace = [
      ...threads,
      { id: "selected", projectPath: "c:/work/project" },
    ]
    expect(
      selectEditorWorkspaceThread(sameWorkspace, "C:/work/project", "selected")
        ?.id
    ).toBe("selected")
    expect(
      selectEditorWorkspaceThread(sameWorkspace, "C:/work/new", "selected")?.id
    ).toBe("latest")
    expect(
      selectEditorWorkspaceThread(sameWorkspace, "C:/work/project", "deleted")
        ?.id
    ).toBe("remembered")
  })
  it("falls back to an available project and never invents a removed workspace", () => {
    expect(selectEditorWorkspaceThread(threads, "C:/deleted")?.id).toBe(
      "latest"
    )
    expect(selectEditorWorkspaceThread([threads[0]], "C:/deleted")).toBeNull()
  })
  it("does not merge case-sensitive POSIX paths", () => {
    expect(editorWorkspaceKey("/work/App")).not.toBe(
      editorWorkspaceKey("/work/app")
    )
  })
})
