import type { HistoryMessage } from "../contracts"
import { buildProviderHistoryPrefix } from "../ProviderHistoryPrompt"

/**
 * Codex app-server owns native history after a thread is created. When a
 * local thread must start a fresh native thread, seed the durable history once
 * as inert JSON before the current prompt.
 */
export function buildCodexHistoryPrefix(
  history: ReadonlyArray<HistoryMessage> | undefined
): string {
  return buildProviderHistoryPrefix(history)
}
