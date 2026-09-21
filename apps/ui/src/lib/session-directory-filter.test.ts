import { describe, expect, it } from "vitest"
import {
  filterThreadsForSessionDirectory,
  sessionDirectoryKeys,
} from "@/lib/session-directory-filter"

describe("session directory filter", () => {
  const threads = [
    { id: "a", projectPath: "/repo/app", worktreePath: null },
    { id: "b", projectPath: "/repo/app", worktreePath: "/repo/app-worktree" },
    { id: "c", projectPath: "/repo/other", worktreePath: null },
    { id: "d", projectPath: "", worktreePath: null },
  ]

  it("filters sessions to the active workspace when enabled", () => {
    expect(
      filterThreadsForSessionDirectory(threads, "a", true).map(
        (thread) => thread.id
      )
    ).toEqual(["a", "b"])
  })

  it("keeps all sessions when disabled or no active workspace exists", () => {
    expect(
      filterThreadsForSessionDirectory(threads, "a", false).map(
        (thread) => thread.id
      )
    ).toEqual(["a", "b", "c", "d"])
    expect(
      filterThreadsForSessionDirectory(threads, "d", true).map(
        (thread) => thread.id
      )
    ).toEqual(["a", "b", "c", "d"])
  })

  it("normalizes path separators and case", () => {
    expect(
      sessionDirectoryKeys({
        id: "win",
        projectPath: "C:\\Repo\\App\\",
        worktreePath: "C:/Repo/App",
      })
    ).toEqual(["c:/repo/app"])
  })
})
