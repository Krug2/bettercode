import type { AppState } from "../../appState"
import { HttpError } from "../../errors"
import { threadId as toThreadId } from "../../provider/runtime"
import { autoCompactionContextSnapshot } from "../auto-compaction"

/** Caller owns the dispatch/recovery lease. No session is retired until the
 * summary's durable source snapshot has been checked under maintenance. */
export async function commitContextCheckpoint(
  state: AppState,
  input: {
    commit: Parameters<AppState["threads"]["commitCompaction"]>[0]
    excludeMessageId: string | null
    expected: { compactionGeneration: number; lastMessageId: string | null }
    assertSource?: () => void
  },
) {
  const threadId = input.commit.thread_id
  return state.providerHub.withThreadMaintenance(threadId, () =>
    state.providers.withThreadMaintenance(threadId, async () => {
      const current = autoCompactionContextSnapshot(
        state.threads.listMessages(threadId, { limit: 2_000 }),
        { excludeMessageId: input.excludeMessageId },
      )
      if (current.compactionGeneration !== input.expected.compactionGeneration ||
          current.lastMessageId !== input.expected.lastMessageId) {
        throw new HttpError(409, "Conversation changed while preparing its context checkpoint. Please retry.", "compaction_decision_stale")
      }
      input.assertSource?.()
      const bindings = state.providerSessionBindings.list().filter(binding => binding.threadId === threadId)
      if (bindings.some(binding => binding.activeTurnId ||
          binding.status === "starting" || binding.status === "running" || binding.status === "closing")) {
        throw new HttpError(409, "Cannot checkpoint a conversation while a provider turn is active.", "turn_active")
      }
      await Promise.all(bindings.map(binding => state.providerHub.stopSession(
        binding.providerKind, toThreadId(threadId), binding.providerInstanceId,
      )))
      return state.threads.commitCompaction(input.commit)
    }),
  )
}
