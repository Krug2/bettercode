import { useCallback, useEffect, useRef, useState } from "react"
import { gitStatus, isGitRepo } from "@/services/backend/gitApi"
import { useVisibilityInterval } from "@/hooks/use-visibility-interval"

type BranchResult =
  | { status: "ready"; branch: string }
  | { status: "loading" | "not-repo" | "unavailable" }

// Chats can share a checkout. Coalesce simultaneous reads without retaining
// stale branches after a checkout or an authorization change.
const pending = new Map<string, Promise<BranchResult>>()

function readBranch(path: string): Promise<BranchResult> {
  const existing = pending.get(path)
  if (existing) return existing
  const request = (async (): Promise<BranchResult> => {
    try {
      if (!(await isGitRepo(path))) return { status: "not-repo" }
      const { branch } = await gitStatus(path)
      return branch?.trim()
        ? { status: "ready", branch: branch.trim() }
        : { status: "unavailable" }
    } catch {
      return { status: "unavailable" }
    }
  })().finally(() => pending.delete(path))
  pending.set(path, request)
  return request
}

export function useWorkspaceBranch(path: string | null, refreshKey: string) {
  const [snapshot, setSnapshot] = useState<{
    path: string
    result: BranchResult
  } | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    let active = true
    let busy = false
    const load = () => {
      if (!path || busy || document.visibilityState !== "visible") return
      busy = true
      void readBranch(path).then((result) => {
        busy = false
        if (active) setSnapshot({ path, result })
      })
    }
    refreshRef.current = load
    load()
    window.addEventListener("focus", load)
    return () => {
      active = false
      refreshRef.current = () => {}
      window.removeEventListener("focus", load)
    }
  }, [path, refreshKey])

  useVisibilityInterval(refresh, 15_000, {
    enabled:
      Boolean(path) &&
      !(snapshot?.path === path && snapshot?.result.status === "unavailable"),
    runOnVisible: true,
  })

  const result: BranchResult =
    snapshot?.path === path ? snapshot.result : { status: "loading" }
  const label = !path
    ? "No folder"
    : result.status === "ready"
      ? result.branch === "HEAD (no branch)"
        ? "Detached HEAD"
        : result.branch
      : result.status === "not-repo"
        ? "No Git repository"
        : result.status === "unavailable"
          ? "Branch unavailable"
          : "Loading branch…"
  return { label, status: result.status, refresh }
}
