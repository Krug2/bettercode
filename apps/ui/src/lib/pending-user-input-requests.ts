import { asRecord } from "@betterc0de/schema"
import type { ThreadActivity } from "@/lib/chat-store"
import {
  isStalePendingUserInputFailureActivity,
  requestIdFromActivity,
} from "@/lib/pending-provider-requests"

/**
 * Pure derivation of pending provider `user_input` requests (AskUserQuestion)
 * from a thread's activity log. Extracted from pending-questions-panel.tsx so
 * the attention system shares the same pairing rules — and upgraded to keep
 * the question `header` (chip label) instead of dropping it.
 */

export type PanelQuestion = {
  id: string
  text: string
  /** Short chip label from AskUserQuestion (e.g. "Auth method"). */
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

export type PendingProviderUserInput = {
  requestId: string
  providerKind: string
  providerInstanceId?: string
  questions: PanelQuestion[]
  createdAt: string
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeQuestionOptions(raw: unknown): PanelQuestion["options"] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((option) => {
      if (typeof option === "string") return { label: option }
      const record = asRecord(option)
      const label = stringFrom(record.label)
      if (!label) return null
      const description = stringFrom(record.description)
      return description ? { label, description } : { label }
    })
    .filter(
      (option): option is { label: string; description?: string } =>
        option !== null
    )
}

export function normalizeProviderQuestion(
  raw: unknown,
  index: number
): PanelQuestion | null {
  const record = asRecord(raw)
  const header = stringFrom(record.header)
  const text =
    stringFrom(record.question) ??
    stringFrom(record.text) ??
    header ??
    `Question ${index + 1}`
  const id = stringFrom(record.id) ?? stringFrom(record.question) ?? text
  return {
    id,
    text,
    ...(header ? { header } : {}),
    options: normalizeQuestionOptions(record.options),
    ...(typeof record.multiSelect === "boolean"
      ? { multiSelect: record.multiSelect }
      : {}),
  }
}

export function derivePendingProviderUserInputs(
  activities: ThreadActivity[]
): PendingProviderUserInput[] {
  const open = new Map<string, PendingProviderUserInput>()
  const sorted = [...activities].sort((a, b) => {
    const seqA = typeof a.sequence === "number" ? a.sequence : 0
    const seqB = typeof b.sequence === "number" ? b.sequence : 0
    if (seqA !== seqB) return seqA - seqB
    return a.createdAt.localeCompare(b.createdAt)
  })

  // Settled requests are collected up front so a request can never be
  // re-opened by an ordering accident. Sequence numbers come from two
  // different emitters — the provider event projection and the HTTP routes —
  // and a resolution really has been observed with a LOWER sequence than the
  // request it answers, which made an answered question reappear the instant
  // it was submitted.
  const settled = new Set<string>()
  for (const activity of sorted) {
    const requestId = requestIdFromActivity(activity)
    if (!requestId) continue
    if (
      activity.kind === "user-input.resolved" ||
      isStalePendingUserInputFailureActivity(activity)
    ) {
      settled.add(requestId)
    }
  }

  for (const activity of sorted) {
    const payload = asRecord(activity.payload)
    const requestId = requestIdFromActivity(activity)
    if (!requestId || settled.has(requestId)) continue
    if (activity.kind === "user-input.requested") {
      const questions = Array.isArray(payload.questions)
        ? payload.questions
            .map((question, index) =>
              normalizeProviderQuestion(question, index)
            )
            .filter((question): question is PanelQuestion => question !== null)
        : []
      if (questions.length === 0) continue
      open.set(requestId, {
        requestId,
        providerKind:
          stringFrom(payload.providerKind) ??
          stringFrom(payload.provider_kind) ??
          "claude",
        providerInstanceId:
          stringFrom(payload.providerInstanceId) ??
          stringFrom(payload.provider_instance_id) ??
          activity.providerInstanceId ??
          undefined,
        questions,
        createdAt: activity.createdAt,
      })
      continue
    }
  }
  return [...open.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}
