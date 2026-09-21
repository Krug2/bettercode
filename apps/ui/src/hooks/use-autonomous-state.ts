import { useChatStore } from "@/lib/chat-store"

/**
 * Reactive read of the autonomous-mode state slice from the chat store.
 *
 * Each field is its own selector so zustand's default equality check
 * can bail out re-renders on unrelated state changes — don't collapse
 * into a single object-returning selector.
 */
export function useAutonomousState() {
  return {
    autonomousMode: useChatStore((s) => s.autonomousMode),
    autonomousTask: useChatStore((s) => s.autonomousTask),
    autonomousStatus: useChatStore((s) => s.autonomousStatus),
    autonomousIterations: useChatStore((s) => s.autonomousIterations),
    autonomousMaxIterations: useChatStore((s) => s.autonomousMaxIterations),
    autonomousTaskList: useChatStore((s) => s.autonomousTaskList),
    autonomousTimeBudgetMin: useChatStore((s) => s.autonomousTimeBudgetMin),
    autonomousStartedAt: useChatStore((s) => s.autonomousStartedAt),
    autonomousStopReason: useChatStore((s) => s.autonomousStopReason),
  }
}
