import { describe, expect, it } from "vitest"
import {
  resolveNewThreadContext,
  resolveThreadRuntimePath,
} from "./thread-context"

describe("resolveNewThreadContext", () => {
  it("prefers an explicitly selected folder over active thread context", () => {
    expect(
      resolveNewThreadContext({
        selectedPath: "/repo/selected",
        activeThread: {
          projectName: "Current",
          projectPath: "/repo/current",
          envMode: "worktree",
          branch: "agent/current",
          worktreePath: "/repo/current-worktree",
          baseBranch: "main",
          worktreeState: "ready",
        },
      })
    ).toEqual({
      projectName: "selected",
      projectPath: "/repo/selected",
    })
  })

  it("inherits active project, branch, and worktree metadata by default", () => {
    expect(
      resolveNewThreadContext({
        activeThread: {
          projectName: "Current",
          projectPath: "/repo/current",
          envMode: "worktree",
          branch: "agent/current",
          worktreePath: "/repo/current-worktree",
          baseBranch: "main",
          worktreeState: "ready",
        },
      })
    ).toEqual({
      projectName: "Current",
      projectPath: "/repo/current",
      options: {
        envMode: "worktree",
        branch: "agent/current",
        worktreePath: "/repo/current-worktree",
        baseBranch: "main",
        worktreeState: "ready",
      },
    })
  })

  it("falls back to the default BetterC0de project without context", () => {
    expect(resolveNewThreadContext({})).toEqual({ projectName: "BetterC0de" })
  })
})

describe("resolveThreadRuntimePath", () => {
  it("uses the worktree checkout path for worktree-scoped threads", () => {
    expect(
      resolveThreadRuntimePath({
        envMode: "worktree",
        projectPath: "/repo",
        worktreePath: "/repo/.betterc0de-worktrees/thread-1",
      })
    ).toBe("/repo/.betterc0de-worktrees/thread-1")
  })

  it("falls back to the project path for local threads", () => {
    expect(
      resolveThreadRuntimePath({
        envMode: "local",
        projectPath: "/repo",
        worktreePath: null,
      })
    ).toBe("/repo")
  })

  it("returns null when no runnable path is attached", () => {
    expect(
      resolveThreadRuntimePath({
        envMode: "local",
        projectPath: "",
        worktreePath: null,
      })
    ).toBeNull()
  })
})
