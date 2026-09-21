import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  gitApplyHunk,
  gitDiff,
  gitDiffStaged,
  gitUserProfile,
  isGitRepo,
} from "./gitApi"
import { invoke } from "./runtime"

vi.mock("./runtime", () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)

describe("gitApi", () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
  })

  it("unwraps backend git repo envelopes into booleans", async () => {
    mockedInvoke.mockResolvedValueOnce({ is_repo: false })
    await expect(isGitRepo("/not-a-repo")).resolves.toBe(false)

    mockedInvoke.mockResolvedValueOnce({ is_repo: true })
    await expect(isGitRepo("/repo")).resolves.toBe(true)
  })

  it("keeps boolean git repo responses backward-compatible", async () => {
    mockedInvoke.mockResolvedValueOnce(true)
    await expect(isGitRepo("/repo")).resolves.toBe(true)
  })

  it("normalizes git diff aliases for existing panels", async () => {
    mockedInvoke.mockResolvedValueOnce({ diff: "diff --git a/a b/a" })

    await expect(gitDiff("/repo")).resolves.toMatchObject({
      diff: "diff --git a/a b/a",
      diff_text: "diff --git a/a b/a",
      diffText: "diff --git a/a b/a",
    })
  })

  it("normalizes staged git diff aliases too", async () => {
    mockedInvoke.mockResolvedValueOnce({ diffText: "staged diff" })

    await expect(gitDiffStaged("/repo")).resolves.toMatchObject({
      diff: "staged diff",
      diff_text: "staged diff",
      diffText: "staged diff",
    })
  })

  it("loads the effective Git profile for the active workspace", async () => {
    mockedInvoke.mockResolvedValueOnce({
      name: "Test User",
      email: "123+octocat@users.noreply.github.com",
      githubUser: "octocat",
    })

    await expect(gitUserProfile("/repo")).resolves.toEqual({
      name: "Test User",
      email: "123+octocat@users.noreply.github.com",
      githubUser: "octocat",
    })
    expect(mockedInvoke).toHaveBeenCalledWith("/git/profile", {
      args: { cwd: "/repo" },
      method: "POST",
      body: { cwd: "/repo" },
    })
  })

  it("normalizes a blank cwd to null so no folder open falls back to global identity", async () => {
    mockedInvoke.mockResolvedValueOnce({
      name: null,
      email: null,
      githubUser: null,
    })

    // At startup with no project open the caller passes "" — `?? null` would
    // leave it as "" and the backend's non-blank gitPath rule would 400.
    await gitUserProfile("   ")

    expect(mockedInvoke).toHaveBeenCalledWith("/git/profile", {
      args: { cwd: null },
      method: "POST",
      body: { cwd: null },
    })
  })

  it("sends an exact typed hunk action to the authoritative backend route", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      action: "accept",
      patchId: "a".repeat(64),
      applied: true,
    })
    const input = {
      cwd: "/repo",
      path: "src/example.ts",
      source: "unstaged" as const,
      action: "accept" as const,
      patch:
        "diff --git a/src/example.ts b/src/example.ts\n" +
        "--- a/src/example.ts\n" +
        "+++ b/src/example.ts\n" +
        "@@ -1 +1 @@\n-old\n+new\n",
    }

    await expect(gitApplyHunk(input)).resolves.toMatchObject({
      ok: true,
      action: "accept",
    })
    expect(mockedInvoke).toHaveBeenCalledWith("/git/hunks/apply", {
      args: expect.objectContaining({
        ...input,
        operationId: expect.any(String),
      }),
      method: "POST",
      body: expect.objectContaining({
        ...input,
        operationId: expect.any(String),
      }),
    })
  })
})
