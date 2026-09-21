import type { ProviderRuntimeEvent as CanonicalProviderRuntimeEvent } from "../contracts"

/**
 * A fixed corpus of canonical provider runtime events, shaped the way the
 * runtime adapters and the hub emit them (base fields, `payload`, the hub's
 * injected `payload.dispatchTurnId`, and a `raw` envelope on one of them).
 *
 * Tests use it in three ways: as the golden input for "what does the user
 * see" (activities + broadcast frames), as the input for journal-shape
 * assertions, and as the parity corpus that a v2 (legacy) journal row and a
 * v3 (canonical) row of the same event must both replay to. Keep the events
 * boring and deterministic — every id and timestamp is literal.
 *
 * `bridged: false` marks events the legacy bridge declines (`null`): they
 * produce no activity and no frame on either path, and cannot exist as a v2
 * row at all. One sits early in the corpus on purpose: on the canonical path
 * a declined event is journaled, so it consumes a projection sequence that
 * the old bridge-in-front path never did, and every activity after it is
 * numbered one higher. Keeping it early makes that skew visible in the
 * goldens instead of hiding it at the tail.
 */
export interface CanonicalJournalFixture {
  readonly name: string
  readonly bridged: boolean
  readonly event: CanonicalProviderRuntimeEvent
}

export const FIXTURE_THREAD_ID = "thread-fixture"
export const FIXTURE_TURN_ID = "turn-1"
export const FIXTURE_DISPATCH_TURN_ID = "dispatch-1"

const base = {
  threadId: FIXTURE_THREAD_ID,
  providerKind: "codex",
  providerInstanceId: "codex-work",
} as const

function fixture(
  name: string,
  event: CanonicalProviderRuntimeEvent,
  bridged = true
): CanonicalJournalFixture {
  return { name, bridged, event }
}

/**
 * `dispatchTurnId` is injected by the hub into `payload` for correlated
 * lifecycle events; the zod payload schemas of `session.exited` do not list
 * it, so the fixture is widened here rather than in the schema.
 */
function withInjectedDispatchTurnId<T extends CanonicalProviderRuntimeEvent>(
  event: T,
  dispatchTurnId: string
): T {
  const payload =
    "payload" in event &&
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {}
  return { ...event, payload: { ...payload, dispatchTurnId } } as T
}

export const CANONICAL_JOURNAL_FIXTURES: ReadonlyArray<CanonicalJournalFixture> = [
  fixture("turn.started with dispatchTurnId", {
    ...base,
    type: "turn.started",
    eventId: "evt-turn-started",
    turnId: FIXTURE_TURN_ID,
    at: 1_000,
    payload: {
      model: "gpt-5.5",
      effort: "high",
      dispatchTurnId: FIXTURE_DISPATCH_TURN_ID,
    },
  }),
  fixture(
    "item.started non-tool item (bridge declines)",
    {
      ...base,
      type: "item.started",
      eventId: "evt-item-started-assistant",
      turnId: FIXTURE_TURN_ID,
      itemId: "item-4",
      kind: "assistant_message",
      at: 1_000,
      payload: { itemType: "assistant_message", status: "running" },
    },
    false
  ),
  fixture("message.delta assistant text", {
    ...base,
    type: "message.delta",
    eventId: "evt-message-delta",
    turnId: FIXTURE_TURN_ID,
    at: 1_001,
    delta: "I will run the tests.\n",
    streamKind: "assistant_text",
  }),
  fixture("tool.started", {
    ...base,
    type: "tool.started",
    eventId: "evt-tool-started",
    turnId: FIXTURE_TURN_ID,
    at: 1_002,
    toolId: "tool-1",
    toolName: "exec_command",
    title: "Run tests",
    detail: "npm test",
    input: { command: "npm test" },
  }),
  fixture("item.updated tool snapshot (cumulative)", {
    ...base,
    type: "item.updated",
    eventId: "evt-item-updated",
    turnId: FIXTURE_TURN_ID,
    itemId: "tool-1",
    kind: "tool:exec_command",
    at: 1_003,
    payload: {
      itemType: "command_execution",
      status: "running",
      title: "Run tests",
      detail: "npm test",
      output: "> vitest run\n",
    },
  }),
  fixture("tool.completed with raw envelope", {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed",
    turnId: FIXTURE_TURN_ID,
    at: 1_004,
    toolId: "tool-1",
    toolName: "exec_command",
    title: "Run tests",
    output: { stdout: "ok", exitCode: 0 },
    raw: {
      source: "codex.eventmsg",
      messageType: "exec_command_end",
      payload: { call_id: "tool-1", stdout: "ok", exit_code: 0 },
    },
  }),
  fixture("tool.failed", {
    ...base,
    type: "tool.failed",
    eventId: "evt-tool-failed",
    turnId: FIXTURE_TURN_ID,
    at: 1_005,
    toolId: "tool-2",
    toolName: "read_file",
    error: "ENOENT: missing.ts",
  }),
  fixture("item.started tool item", {
    ...base,
    type: "item.started",
    eventId: "evt-item-started",
    turnId: FIXTURE_TURN_ID,
    itemId: "item-2",
    kind: "tool:apply_patch",
    at: 1_006,
    payload: {
      itemType: "file_change",
      status: "running",
      title: "Edit a.ts",
      data: { input: { path: "a.ts" } },
    },
  }),
  fixture("item.completed tool item", {
    ...base,
    type: "item.completed",
    eventId: "evt-item-completed",
    turnId: FIXTURE_TURN_ID,
    itemId: "item-2",
    kind: "tool:apply_patch",
    at: 1_007,
    payload: {
      itemType: "file_change",
      status: "completed",
      title: "Edit a.ts",
      data: { output: "patched a.ts" },
    },
  }),
  fixture("request.opened plan_approval", {
    ...base,
    type: "request.opened",
    eventId: "evt-request-plan",
    turnId: FIXTURE_TURN_ID,
    at: 1_008,
    requestId: "req-plan-1",
    kind: "plan_approval",
    planMarkdown: "# Plan\n\n- run tests\n- fix failures\n",
  }),
  fixture("request.opened tool_approval", {
    ...base,
    type: "request.opened",
    eventId: "evt-request-tool",
    turnId: FIXTURE_TURN_ID,
    at: 1_009,
    requestId: "req-tool-1",
    kind: "tool_approval",
    tool: "exec_command",
    input: { command: "git status" },
    title: "Run git status",
  }),
  fixture("request.resolved approve", {
    ...base,
    type: "request.resolved",
    eventId: "evt-request-resolved",
    turnId: FIXTURE_TURN_ID,
    at: 1_010,
    requestId: "req-tool-1",
    decision: "approve",
  }),
  fixture("tool.denied", {
    ...base,
    type: "tool.denied",
    eventId: "evt-tool-denied",
    turnId: FIXTURE_TURN_ID,
    at: 1_011,
    payload: {
      toolName: "rm",
      toolUseId: "tool-3",
      reason: "workspace is read-only",
    },
  }),
  fixture("token.usage", {
    ...base,
    type: "token.usage",
    eventId: "evt-token-usage",
    turnId: FIXTURE_TURN_ID,
    at: 1_012,
    usage: {
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      cachedInputTokens: 20,
      durationMs: 800,
    },
  }),
  fixture("turn.diff.updated", {
    ...base,
    type: "turn.diff.updated",
    eventId: "evt-turn-diff",
    turnId: FIXTURE_TURN_ID,
    at: 1_013,
    payload: {
      unifiedDiff:
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+next\n",
      files: [{ path: "a.ts", additions: 2, deletions: 1 }],
    },
  }),
  fixture("runtime.error", {
    ...base,
    type: "runtime.error",
    eventId: "evt-runtime-error",
    turnId: FIXTURE_TURN_ID,
    at: 1_014,
    message: "provider exploded",
    class: "provider_error",
  }),
  fixture("turn.completed status failed", {
    ...base,
    type: "turn.completed",
    eventId: "evt-turn-failed",
    turnId: FIXTURE_TURN_ID,
    at: 1_015,
    status: "failed",
    error: "model refused",
    payload: {
      state: "failed",
      errorMessage: "model refused",
      dispatchTurnId: FIXTURE_DISPATCH_TURN_ID,
    },
  }),
  fixture("turn.completed status completed", {
    ...base,
    type: "turn.completed",
    eventId: "evt-turn-completed",
    turnId: "turn-2",
    at: 1_016,
    status: "completed",
    payload: {
      state: "completed",
      stopReason: "end_turn",
      dispatchTurnId: "dispatch-2",
    },
  }),
  fixture("turn.aborted", {
    ...base,
    type: "turn.aborted",
    eventId: "evt-turn-aborted",
    turnId: "turn-3",
    at: 1_017,
    payload: {
      reason: "user interrupt",
      status: "interrupted",
      dispatchTurnId: "dispatch-3",
    },
  }),
  fixture(
    "session.exited with injected dispatchTurnId",
    withInjectedDispatchTurnId(
      {
        ...base,
        type: "session.exited",
        eventId: "evt-session-exited",
        at: 1_018,
        reason: "process exited with code 1",
        recoverable: false,
        exitKind: "error",
        payload: {
          reason: "process exited with code 1",
          recoverable: false,
          exitKind: "error",
        },
      },
      "dispatch-4"
    )
  ),
  fixture("session.state.changed", {
    ...base,
    type: "session.state.changed",
    eventId: "evt-session-state",
    at: 1_019,
    state: "ready",
    payload: { state: "ready" },
  }),
  fixture(
    "request.opened tool_user_input (bridge declines)",
    {
      ...base,
      type: "request.opened",
      eventId: "evt-request-user-input",
      turnId: FIXTURE_TURN_ID,
      at: 1_021,
      requestId: "req-user-input-1",
      payload: { requestType: "tool_user_input", detail: "pick a branch" },
    },
    false
  ),
]

/**
 * A small `tool.completed` under a native envelope many times its own size —
 * what an ACP or BetterC0deCompat adapter attaches as `raw`. Kept out of the
 * corpus (it would only duplicate the `tool.completed` goldens) and fed to
 * the journal size guard, which must fail if `raw` ever reaches a row again:
 * the corpus fixture's ~125 B envelope is too small to trip any sane bound.
 */
export const RAW_HEAVY_TOOL_COMPLETED_FIXTURE: CanonicalJournalFixture = fixture(
  "tool.completed under a 4 KiB raw envelope",
  {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed-raw-heavy",
    turnId: FIXTURE_TURN_ID,
    at: 1_030,
    toolId: "tool-raw",
    toolName: "read_file",
    output: { content: "v1\n" },
    raw: {
      source: "acp.session/update",
      method: "session/update",
      messageType: "tool_call_update",
      payload: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "acp-session-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-raw",
            status: "completed",
            content: [
              {
                type: "content",
                content: { type: "text", text: "v1\n" },
              },
            ],
            rawOutput: "#".repeat(4 * 1024),
          },
        },
      },
    },
  }
)

/**
 * Over the limit without any single big value: 25 content blocks of 60 KiB,
 * each under the first per-string cap (64 KiB). The old cap loop returned
 * "unboundable" on its first pass because that cap cut nothing; the ladder
 * has to descend to 32 KiB, where the blocks are cut and the event fits.
 */
export function oversizedToolCompletedManyBlocksFixture(
  blocks = 25,
  blockBytes = 60 * 1024
): CanonicalProviderRuntimeEvent {
  return {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed-many-blocks",
    turnId: FIXTURE_TURN_ID,
    at: 2_003,
    toolId: "tool-many-blocks",
    toolName: "mcp__docs__search",
    output: {
      content: Array.from({ length: blocks }, (_, index) => ({
        type: "text",
        text: String.fromCharCode(97 + (index % 26)).repeat(blockBytes),
      })),
    },
  }
}

/**
 * Over the limit only through thousands of short strings, so bounding has to
 * descend to the 256 B floor, past the length of the identity strings the hub
 * nests in `payload`. Those must survive the cut untouched at every depth.
 */
export function oversizedToolCompletedNestedIdentityFixture(
  strings = 3_000,
  stringBytes = 400
): CanonicalProviderRuntimeEvent {
  return {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed-nested-identity",
    turnId: FIXTURE_TURN_ID,
    at: 2_004,
    toolId: "tool-nested-identity",
    toolName: "exec_command",
    output: {
      lines: Array.from({ length: strings }, () => "x".repeat(stringBytes)),
    },
    payload: {
      dispatchTurnId: "d".repeat(300),
      toolUseId: "u".repeat(300),
      requestId: "r".repeat(300),
      detail: "detail-".repeat(60),
      nested: { turn_id: "t".repeat(300), note: "n".repeat(300) },
    },
  }
}

/** A `tool.completed` whose top-level `output` is over the 1 MiB journal limit. */
export function oversizedToolCompletedFixture(
  bytes = 2 * 1024 * 1024
): CanonicalProviderRuntimeEvent {
  return {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed-big",
    turnId: FIXTURE_TURN_ID,
    at: 2_000,
    toolId: "tool-big",
    toolName: "exec_command",
    output: "x".repeat(bytes),
  }
}

/**
 * Oversized strings at both placements the bounded copy has to find: the
 * canonical top-level `output` and a nested `payload.data.stdout`.
 */
export function oversizedToolCompletedNestedFixture(
  bytes = 2 * 1024 * 1024
): CanonicalProviderRuntimeEvent {
  return {
    ...base,
    type: "tool.completed",
    eventId: "evt-tool-completed-big-nested",
    turnId: FIXTURE_TURN_ID,
    at: 2_001,
    toolId: "tool-big-nested",
    toolName: "exec_command",
    output: "x".repeat(bytes),
    payload: { data: { stdout: "y".repeat(bytes), keep: 7 } },
  }
}

/** A `turn.diff.updated` whose patch alone is over the journal limit. */
export function oversizedDiffFixture(
  bytes = 2 * 1024 * 1024
): CanonicalProviderRuntimeEvent {
  return {
    ...base,
    type: "turn.diff.updated",
    eventId: "evt-turn-diff-big",
    turnId: FIXTURE_TURN_ID,
    at: 2_002,
    payload: {
      unifiedDiff: "+".repeat(bytes),
      files: [{ path: "a.ts", additions: 1, deletions: 0 }],
    },
  }
}

/** Deep copy so a test that mutates (or a bridge that spreads) cannot leak between cases. */
export function cloneFixtureEvent<T>(event: T): T {
  return structuredClone(event)
}
