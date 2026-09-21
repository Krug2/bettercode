import { expect, it, vi } from "vitest"
import type { BootRoot, ProvidersContext } from "./context"
import { recoverCheckpointsAndWorktrees } from "./recovery"

vi.mock("../services/checkpoint-revert-saga", () => ({
  recoverPendingCheckpointReverts: vi.fn(async () => undefined),
}))
vi.mock("../http/checkpointRecoveryFence", () => ({
  withCheckpointRecoveryMutation: vi.fn(
    async (_state: unknown, _scope: unknown, operation: () => Promise<unknown>) => operation()
  ),
}))

it("drains sibling worktree recovery before rejecting startup", async () => {
  let rejectFirst!: (error: Error) => void
  const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
  let releaseSibling!: () => void
  const sibling = new Promise<void>((resolve) => { releaseSibling = resolve })
  const failure = new Error("first repository failed")
  const reconcile = vi.fn((repository: string) => repository === "first" ? first : sibling)
  const recoverOrphansAtStartup = vi.fn(async () => 0)
  const root = { options: {}, startupCleanup: [] } as unknown as BootRoot
  const providers = {
    checkpointTurnSlots: { reconcileAll: vi.fn() },
    checkpointReactor: { recoverPendingAdmissions: vi.fn(async () => 0) },
    registeredRepositories: ["first", "sibling", "third", "fourth", "unstarted"],
    checkpointReverts: { blockingThreadForCwd: vi.fn(() => null) },
    worktrees: { reconcile },
    checkpointRefCleanup: { recoverOrphansAtStartup, start: vi.fn() },
    state: {},
  } as unknown as ProvidersContext
  let settled = false
  const recovering = recoverCheckpointsAndWorktrees(root, providers)
  const outcome = recovering.then(
    () => { settled = true; return null },
    (error: unknown) => { settled = true; return error }
  )
  await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(4))
  rejectFirst(failure)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  releaseSibling()
  expect(await outcome).toBe(failure)
  expect(reconcile).toHaveBeenCalledTimes(4)
  expect(recoverOrphansAtStartup).not.toHaveBeenCalled()
})
