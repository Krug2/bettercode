import type { CodexNativeEvent } from "../CodexSessionRuntime"

/** A Codex JSON-RPC notification with its method and params already unwrapped. */
export interface CodexNotificationContext {
  readonly threadId: string
  readonly native: CodexNativeEvent
  readonly method: string
  /** Untyped on purpose: every family reads fields through the shared readers. */
  readonly params: unknown
}
