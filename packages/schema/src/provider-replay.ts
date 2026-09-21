export interface ProviderReplayRequest {
  type: "provider_replay"
  journalId: string
  afterSequence: number
}

type Frame = Record<string, unknown>

/** Transport-independent replay state shared by desktop and mobile clients. */
export class ProviderReplayCursor {
  private journalId: string | null = null
  private lastSequence = 0
  private gapAnnounced = false

  negotiate(metadata: unknown): ProviderReplayRequest | null {
    this.gapAnnounced = false
    if (!isRecord(metadata)) return null
    const journalId = metadata.journalId
    const latest = metadata.latestSequence
    if (typeof journalId !== "string" || !journalId || !isSequence(latest)) {
      return null
    }

    const changed = this.journalId !== null && this.journalId !== journalId
    const ahead = this.journalId === journalId && this.lastSequence > latest
    const request: ProviderReplayRequest = {
      type: "provider_replay",
      // Sending the old journal lets the server announce the restart gap.
      journalId: changed ? this.journalId! : journalId,
      afterSequence: ahead ? 0 : this.lastSequence,
    }
    if (changed || ahead) this.lastSequence = 0
    this.journalId = journalId
    return request
  }

  deliver(frame: Frame, receive: (frame: Frame) => void): void {
    if (frame.type === "provider_replay_gap") {
      this.gapAnnounced = true
      receive(frame)
      return
    }
    if (frame.type === "provider_replay_complete") {
      this.gapAnnounced = false
      return
    }

    const { sequence, journalId } = frame
    if (
      frame.channel !== "provider.runtimeEvent" ||
      !isSequence(sequence) ||
      typeof journalId !== "string" ||
      !journalId
    ) {
      receive(frame)
      return
    }
    if (this.journalId !== journalId) {
      this.journalId = journalId
      this.lastSequence = 0
    }
    if (sequence <= this.lastSequence) return
    if (sequence > this.lastSequence + 1 && !this.gapAnnounced) {
      receive({
        type: "provider_replay_gap",
        journalId,
        requestedAfterSequence: this.lastSequence,
        earliestAvailableSequence: sequence,
        latestSequence: sequence,
        reason: "sequence_gap",
      })
    }
    receive(frame)
    // Never acknowledge data that the receiving store failed to apply.
    this.lastSequence = sequence
    this.gapAnnounced = false
  }
}

function isRecord(value: unknown): value is Frame {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
