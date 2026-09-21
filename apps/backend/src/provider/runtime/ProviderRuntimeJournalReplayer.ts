import { isRecord } from "@betterc0de/schema"
import type { OrchestrationEvent } from "../../persistence/eventStore"
import type { EventStore } from "../../persistence/eventStore"
import type { ProviderRuntimeEvent as CanonicalProviderRuntimeEvent } from "./contracts"
import {
  CANONICAL_JOURNAL_SCHEMA,
  type JournalTruncationRecord,
  type ProviderRuntimeJournalEntry,
} from "./journalEntry"
import type {
  ProviderRuntimeIngestionLogger,
  ProviderRuntimeProjectionReceiptStore,
} from "./ProviderRuntimeIngestion"

const DEFAULT_REPLAY_BATCH_SIZE = 256
const MAX_REPLAY_BATCH_SIZE = 1_000
/**
 * Startup replays a failing row gets before it is discarded. A row that
 * cannot be projected on any boot (a "poison pill") used to block startup
 * forever: the backend threw, the app restarted, the same row threw again.
 */
export const MAX_JOURNAL_REPLAY_ATTEMPTS = 3

class ProviderRuntimeJournalUnrecoverableEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProviderRuntimeJournalUnrecoverableEventError"
  }
}

interface ProviderRuntimeReplaySource {
  readUnprojectedProviderRuntimeEvents(limit: number): OrchestrationEvent[]
}

interface ProviderRuntimeReplayReceipts extends ProviderRuntimeProjectionReceiptStore {
  markDiscarded(eventSequence: number, error: string): void
  /**
   * Counts one replay attempt of a row and returns the total. Called
   * *before* the row is replayed so an attempt that crashes the backend
   * (the very failure the budget exists for) is still counted. Without it
   * the replayer cannot discard a poison pill and only reports the block.
   */
  recordReplayAttempt?(eventSequence: number, error: string): number
  /** Records why the counted attempt failed, without counting it again. */
  noteReplayAttemptError?(eventSequence: number, error: string): void
}

export interface ProviderRuntimeReplayInput {
  readonly projectionSequence: number
  /**
   * How the row was bounded when it was journaled, read back from the row
   * metadata of a canonical row so the replayed legacy view carries the same
   * `payloadTruncated` / `journal_truncation` markers the live one did. Null
   * for a legacy row (its markers are inside `payload`) and for an unbounded
   * row.
   */
  readonly truncation?: JournalTruncationRecord | null
}

interface ProviderRuntimeReplayProjector {
  replayPersisted(
    entry: ProviderRuntimeJournalEntry,
    input: ProviderRuntimeReplayInput
  ): void
}

export interface ProviderRuntimeJournalReplayBlock {
  readonly eventSequence: number
  readonly eventType: string
  readonly thread: string
  readonly attempts: number
  readonly maxAttempts: number
  readonly error: unknown
}

export interface ProviderRuntimeJournalReplayResult {
  readonly replayed: number
  readonly discarded: number
  /**
   * Set when a row failed but has attempts left: the rest of *that thread*
   * is skipped for this pass (its later rows must not project ahead of the
   * failed one) and retried on the next startup, while other threads keep
   * replaying. Reports the first such row; every one is logged. The caller
   * logs and continues; it does not fail startup for one row.
   */
  readonly blocked: ProviderRuntimeJournalReplayBlock | null
}

/** Placeholder reason stored when an attempt is counted, before it runs. */
const REPLAY_ATTEMPT_IN_PROGRESS = "startup replay attempt in progress"

/** Replays provider events that were journaled but not fully projected. */
export class ProviderRuntimeJournalReplayer {
  private readonly source: ProviderRuntimeReplaySource

  constructor(
    eventStore: EventStore,
    private readonly receipts: ProviderRuntimeReplayReceipts,
    private readonly projector: ProviderRuntimeReplayProjector,
    private readonly logger: ProviderRuntimeIngestionLogger,
    private readonly maxAttempts = MAX_JOURNAL_REPLAY_ATTEMPTS
  ) {
    this.source = eventStore
  }

  replayAll(batchSize = DEFAULT_REPLAY_BATCH_SIZE): ProviderRuntimeJournalReplayResult {
    const limit = Math.min(
      MAX_REPLAY_BATCH_SIZE,
      Math.max(1, Math.floor(batchSize))
    )
    let replayed = 0
    let discarded = 0
    // A thread whose row failed with attempts left. Its later rows are
    // skipped for this pass — never projected ahead of the failed one — but
    // every other thread keeps replaying; one poisoned thread used to halt
    // the replay of all of them.
    const blockedThreads = new Map<string, ProviderRuntimeJournalReplayBlock>()
    let firstBlock: ProviderRuntimeJournalReplayBlock | null = null

    while (true) {
      const events = this.source.readUnprojectedProviderRuntimeEvents(limit)
      if (events.length === 0) break
      let progressed = false

      for (const stored of events) {
        if (blockedThreads.has(stored.stream_id)) continue
        // Counted before anything runs: a row that crashes the backend
        // during projection must still burn one of its attempts, or a
        // poison pill boot-loops forever without ever reaching the budget.
        const attempts =
          this.receipts.recordReplayAttempt?.(
            stored.sequence,
            REPLAY_ATTEMPT_IN_PROGRESS
          ) ?? 1
        // An earlier process may have exited inside projection, before the
        // catch block could enforce the budget. Never re-enter that row once
        // all prior attempts were consumed.
        if (this.receipts.recordReplayAttempt && attempts > this.maxAttempts) {
          this.receipts.markDiscarded(
            stored.sequence,
            `discarded after ${attempts - 1} incomplete startup replay attempt(s)`
          )
          this.logger.error(
            { eventSequence: stored.sequence, thread: stored.stream_id, attempts: attempts - 1 },
            "discarded provider runtime journal event before replay: prior startup attempts exhausted its budget"
          )
          discarded += 1
          progressed = true
          continue
        }
        let parsed: ParsedProviderRuntimeRow
        try {
          parsed = parsePersistedProviderRuntimeEvent(stored)
        } catch (error) {
          if (error instanceof ProviderRuntimeJournalUnrecoverableEventError) {
            const outcome = this.recordFailure(
              stored,
              error,
              "unrecoverable",
              attempts
            )
            if (outcome === "discarded") {
              discarded += 1
              progressed = true
              continue
            }
            blockedThreads.set(stored.stream_id, outcome)
            firstBlock ??= outcome
            continue
          }
          const detail = error instanceof Error ? error.message : String(error)
          this.receipts.markDiscarded(stored.sequence, detail)
          discarded += 1
          progressed = true
          this.logger.error(
            {
              err: error,
              eventSequence: stored.sequence,
              eventType: stored.event_type,
              thread: stored.stream_id,
            },
            "discarded malformed provider runtime journal event"
          )
          continue
        }

        try {
          this.projector.replayPersisted(parsed.entry, {
            projectionSequence: stored.stream_version,
            truncation: parsed.truncation,
          })
          this.receipts.markProjected(stored.sequence)
          replayed += 1
          progressed = true
        } catch (error) {
          const outcome = this.recordFailure(
            stored,
            error,
            "projection",
            attempts
          )
          if (outcome === "discarded") {
            discarded += 1
            progressed = true
            continue
          }
          blockedThreads.set(stored.stream_id, outcome)
          firstBlock ??= outcome
        }
      }

      if (events.length < limit) break
      if (!progressed) {
        // The whole batch belonged to blocked threads, and the next read
        // would return the same rows. Anything behind them waits for the
        // next startup rather than looping here.
        this.logger.warn(
          {
            blockedThreads: [...blockedThreads.keys()],
            batchSize: limit,
          },
          "provider runtime journal replay stopped early: a full batch of rows belongs to threads blocked in this pass; remaining rows are retried on the next startup"
        )
        break
      }
    }

    return { replayed, discarded, blocked: firstBlock }
  }

  /**
   * Records why the (already counted) attempt failed. Past the attempt
   * budget the row is discarded with the reason on its receipt and replay
   * continues; otherwise it stays unreceipted for the next startup and the
   * rest of its thread is skipped for this pass.
   */
  private recordFailure(
    stored: OrchestrationEvent,
    error: unknown,
    kind: "unrecoverable" | "projection",
    attempts: number
  ): ProviderRuntimeJournalReplayBlock | "discarded" {
    const detail = error instanceof Error ? error.message : String(error)
    this.receipts.noteReplayAttemptError?.(stored.sequence, detail)
    const bindings = {
      err: error,
      eventSequence: stored.sequence,
      eventType: stored.event_type,
      thread: stored.stream_id,
      attempts,
      maxAttempts: this.maxAttempts,
    }
    if (
      this.receipts.recordReplayAttempt !== undefined &&
      attempts >= this.maxAttempts
    ) {
      this.receipts.markDiscarded(
        stored.sequence,
        `discarded after ${attempts} failed startup replay attempt(s) (${kind}): ${detail}`
      )
      this.logger.error(
        bindings,
        kind === "unrecoverable"
          ? "provider runtime journal event is unrecoverable; discarded after repeated startup failures"
          : "provider runtime journal replay kept failing; discarded the event so startup can proceed"
      )
      return "discarded"
    }
    this.logger.error(
      bindings,
      kind === "unrecoverable"
        ? "provider runtime journal event is unrecoverable; the rest of its thread is skipped and retried on the next startup"
        : "provider runtime journal replay failed; the rest of its thread is skipped and retried on the next startup"
    )
    return {
      eventSequence: stored.sequence,
      eventType: stored.event_type,
      thread: stored.stream_id,
      attempts,
      maxAttempts: this.maxAttempts,
      error,
    }
  }
}

interface ParsedProviderRuntimeRow {
  readonly entry: ProviderRuntimeJournalEntry
  readonly truncation: JournalTruncationRecord | null
}

/**
 * Reads one journal row back into an entry, dispatching on
 * `metadata_json.schema`: `undefined | 1 | 2` are the legacy shape (every row
 * written before canonical journaling, plus what the frozen in-process stack
 * still writes), `3` is the canonical shape. Any other value is a future
 * writer this binary cannot interpret.
 *
 * A canonical row is checked structurally, never through
 * `providerRuntimeEventSchema.parse`: the zod objects are strip-mode, and a
 * journal-bounded diff row carries `diffTruncationReason: "journal_limit"`
 * where the schema literal is `"output_limit"` — a parse would reject the
 * row or silently drop what it did not know.
 */
export function parsePersistedProviderRuntimeEvent(
  stored: OrchestrationEvent
): ParsedProviderRuntimeRow {
  if (
    !Number.isSafeInteger(stored.stream_version) ||
    stored.stream_version <= 0
  ) {
    throw new Error(
      `Invalid provider runtime stream version '${stored.stream_version}'.`
    )
  }

  let metadata: unknown
  try {
    metadata = JSON.parse(stored.metadata_json)
  } catch (error) {
    throw new Error("Provider runtime metadata is not valid JSON.", {
      cause: error,
    })
  }
  if (!isRecord(metadata)) {
    throw new Error("Provider runtime metadata must be an object.")
  }
  const legacySchema =
    metadata.schema === undefined ||
    metadata.schema === 1 ||
    metadata.schema === 2
  if (!legacySchema && metadata.schema !== CANONICAL_JOURNAL_SCHEMA) {
    throw new ProviderRuntimeJournalUnrecoverableEventError(
      `Unsupported provider runtime journal schema '${String(metadata.schema)}'.`
    )
  }
  if (metadata.truncated === true) {
    throw new ProviderRuntimeJournalUnrecoverableEventError(
      "Provider runtime event was stored as an audit-only truncation and cannot be replayed safely."
    )
  }

  let value: unknown
  try {
    value = JSON.parse(stored.payload_json)
  } catch (error) {
    throw new Error("Provider runtime payload is not valid JSON.", {
      cause: error,
    })
  }
  if (!isRecord(value)) {
    throw new Error("Provider runtime payload must be an object.")
  }

  const truncation = truncationFromMetadata(metadata)
  if (legacySchema) {
    return { entry: parseLegacyRow(stored, value), truncation }
  }
  return { entry: parseCanonicalRow(stored, value), truncation }
}

function parseLegacyRow(
  stored: OrchestrationEvent,
  value: Record<string, unknown>
): ProviderRuntimeJournalEntry {
  const eventType = value.event_type
  const threadId = value.thread_id
  const payload = value.payload
  if (typeof eventType !== "string" || eventType.length === 0) {
    throw new Error("Provider runtime event_type is missing.")
  }
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("Provider runtime thread_id is missing.")
  }
  if (!isRecord(payload)) {
    throw new Error("Provider runtime payload field must be an object.")
  }
  if (stored.event_type !== `ProviderRuntime:${eventType}`) {
    throw new Error("Provider runtime event type does not match its envelope.")
  }
  if (stored.stream_id !== threadId) {
    throw new Error("Provider runtime thread does not match its stream.")
  }

  return {
    shape: "legacy",
    event: { event_type: eventType, thread_id: threadId, payload },
  }
}

function parseCanonicalRow(
  stored: OrchestrationEvent,
  value: Record<string, unknown>
): ProviderRuntimeJournalEntry {
  const type = value.type
  const threadId = value.threadId
  const eventId = value.eventId
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("Provider runtime canonical type is missing.")
  }
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("Provider runtime canonical threadId is missing.")
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw new Error("Provider runtime canonical eventId is missing.")
  }
  if (stored.event_type !== `ProviderRuntime:${type}`) {
    throw new Error("Provider runtime event type does not match its envelope.")
  }
  if (stored.stream_id !== threadId) {
    throw new Error("Provider runtime thread does not match its stream.")
  }
  return {
    shape: "canonical",
    event: value as unknown as CanonicalProviderRuntimeEvent,
  }
}

function truncationFromMetadata(
  metadata: Record<string, unknown>
): JournalTruncationRecord | null {
  if (metadata.payloadTruncated !== true) return null
  const originalBytes =
    typeof metadata.originalBytes === "number" &&
    Number.isFinite(metadata.originalBytes)
      ? metadata.originalBytes
      : 0
  const stringCapBytes =
    typeof metadata.stringCapBytes === "number" &&
    Number.isFinite(metadata.stringCapBytes)
      ? metadata.stringCapBytes
      : undefined
  const fields = Array.isArray(metadata.truncatedFields)
    ? metadata.truncatedFields.filter(
        (field): field is string => typeof field === "string"
      )
    : []
  return {
    originalBytes,
    ...(stringCapBytes !== undefined ? { stringCapBytes } : {}),
    fields,
  }
}
