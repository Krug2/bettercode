/** Scoped to the textarea that owns this recording, never broadcast to other chats. */
export const DICTATION_PREVIEW_EVENT = "betterc0de:dictation-preview"

export interface DictationDraft {
  readonly value: string
  /** UTF-16 offset including the separator before the unconfirmed suffix. */
  readonly interimStart: number | null
}

export function updateDictationDraft(
  currentValue: string,
  previous: DictationDraft | null,
  transcript: string,
  final: boolean,
): DictationDraft {
  const base = previous?.interimStart != null && previous.value === currentValue
    ? currentValue.slice(0, previous.interimStart)
    : currentValue
  const separator = base && transcript && !/\s$/.test(base) ? " " : ""
  return {
    value: base + separator + transcript,
    interimStart: final || !transcript ? null : base.length,
  }
}

export function publishDictationPreview(target: HTMLTextAreaElement, draft: DictationDraft): void {
  target.dispatchEvent(new CustomEvent(DICTATION_PREVIEW_EVENT, { detail: draft }))
}

export function readDictationPreview(event: Event): DictationDraft | null {
  if (!(event instanceof CustomEvent)) return null
  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object" || !("value" in detail) || !("interimStart" in detail)) return null
  if (typeof detail.value !== "string") return null
  const start = detail.interimStart
  if (start !== null && (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start > detail.value.length)) return null
  return { value: detail.value, interimStart: start }
}
