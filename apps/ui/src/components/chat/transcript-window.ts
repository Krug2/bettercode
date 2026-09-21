/** Number of timeline entries mounted at the live end of a chat. */
export const TRANSCRIPT_WINDOW_SIZE = 40

export interface TranscriptWindow<T> {
  readonly visible: readonly T[]
  readonly hiddenBefore: number
  readonly startIndex: number
}

/**
 * Mount only a tail window of the transcript. Off-screen history stays out of
 * the React tree; StickToBottom still sees a spacer for the hidden prefix.
 */
export function windowTranscriptEntries<T>(
  entries: readonly T[],
  options: { readonly size?: number; readonly startIndex?: number } = {}
): TranscriptWindow<T> {
  const size = Math.max(1, Math.floor(options.size ?? TRANSCRIPT_WINDOW_SIZE))
  if (entries.length === 0) {
    return { visible: entries, hiddenBefore: 0, startIndex: 0 }
  }
  const maxStart = Math.max(0, entries.length - size)
  const requested =
    options.startIndex === undefined
      ? maxStart
      : Math.min(maxStart, Math.max(0, Math.floor(options.startIndex)))
  return {
    visible: entries.slice(requested),
    hiddenBefore: requested,
    startIndex: requested,
  }
}
