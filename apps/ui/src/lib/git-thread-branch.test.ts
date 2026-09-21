import { describe, expect, it } from "vitest"
import {
  isTemporaryWorktreeBranch,
  resolveLiveThreadBranchUpdate,
} from "./git-thread-branch"

describe("isTemporaryWorktreeBranch", () => {
  it("matches BetterC0de-generated worktree refs", () => {
    expect(
      isTemporaryWorktreeBranch("agent/deadbeef/github-query-rate-limit")
    ).toBe(true)
    expect(isTemporaryWorktreeBranch(" AGENT/DEADBEEF/TURN ")).toBe(true)
  })

  it("rejects semantic refs and malformed temporary refs", () => {
    expect(isTemporaryWorktreeBranch("feature/github-query-rate-limit")).toBe(
      false
    )
    expect(isTemporaryWorktreeBranch("feature/deadbeef")).toBe(false)
    expect(isTemporaryWorktreeBranch("agent/deadbeef")).toBe(false)
    expect(isTemporaryWorktreeBranch("agent/deadbeef/bad_slug")).toBe(false)
  })
})

describe("resolveLiveThreadBranchUpdate", () => {
  it("returns a branch update when live git status differs from stored thread metadata", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: "feature/old-ref",
        gitBranch: "effect-atom",
      })
    ).toEqual({ branch: "effect-atom" })
  })

  it("returns null when live git branch is unavailable", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: "feature/old-ref",
        gitBranch: undefined,
      })
    ).toBeNull()
  })

  it("returns null when the stored thread ref already matches git status", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: "effect-atom",
        gitBranch: "effect-atom",
      })
    ).toBeNull()
  })

  it("returns null when git status is detached HEAD but the thread already has a ref", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: "effect-atom",
        gitBranch: null,
      })
    ).toBeNull()
  })

  it("does not regress a semantic thread ref back to a temporary worktree ref", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: "feature/github-query-rate-limit",
        gitBranch: "agent/bda76797/github-query-rate-limit",
      })
    ).toBeNull()
  })

  it("updates when an empty thread branch sees a live semantic branch", () => {
    expect(
      resolveLiveThreadBranchUpdate({
        threadBranch: null,
        gitBranch: "feature/new-ref",
      })
    ).toEqual({ branch: "feature/new-ref" })
  })
})
