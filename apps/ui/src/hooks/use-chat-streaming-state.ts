import { asRecord } from "@betterc0de/schema"
import { useMemo } from "react"
import {
  getThreadStream,
  useChatStore,
  type ThreadActivity,
} from "@/lib/chat-store"
import { isStructuredPlanMarkdown } from "@/lib/message-utils"
import { parseBetterC0dePlanJson, unwrapPlanContent } from "@/lib/plan-content"
import { useShimmerPhase } from "@/hooks/use-shimmer-phase"
import type { SourceProposedPlanReference } from "@/lib/plan-modal"

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function sourceProposedPlanKey(source: SourceProposedPlanReference): string {
  return `${source.threadId}::${source.planId}`
}

function sourceProposedPlanFromPayload(
  payload: Record<string, unknown>
): SourceProposedPlanReference | null {
  const source = asRecord(
    payload.sourceProposedPlan ?? payload.source_proposed_plan
  )
  const threadId = stringFrom(source.threadId) ?? stringFrom(source.thread_id)
  const planId = stringFrom(source.planId) ?? stringFrom(source.plan_id)
  return threadId && planId ? { threadId, planId } : null
}

function planContentFromActivity(activity: ThreadActivity): string | null {
  if (activity.kind !== "turn.proposed.completed") return null
  const payload = asRecord(activity.payload)
  return (
    stringFrom(payload.planMarkdown) ??
    stringFrom(payload.plan_markdown) ??
    stringFrom(payload.detail) ??
    null
  )
}

function sourceProposedPlanFromActivity(
  activity: ThreadActivity
): SourceProposedPlanReference {
  return { threadId: activity.threadId, planId: activity.id }
}

interface PlanEntry {
  id: string
  content: string
  preview: string
  createdAt?: string
  streaming: boolean
  sourceProposedPlan?: SourceProposedPlanReference | null
  implemented?: boolean
  implementedAt?: string | null
  implementationThreadId?: string | null
}

function buildPlanPreview(content: string): string {
  const planContent = unwrapPlanContent(content)
  const parsedJsonPlan = parseBetterC0dePlanJson(planContent)
  if (parsedJsonPlan) return parsedJsonPlan.previewContent

  const maxLines = 8
  const lines = planContent
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("```"))
  return lines.slice(0, maxLines).join("\n").trim()
}

/**
 * Bundles every chat-store streaming selector we need into one call,
 * plus the derived plan-preview + shimmer-phase state.
 *
 * Each `useChatStore((s) => getThreadStream(s, s.activeThreadId).X)` is a
 * subscription — we list them individually rather than as one object so
 * zustand can still bail out re-renders at the field level (returning the
 * same primitive value from the selector gives you the usual zustand
 * equality check without needing `shallow`).
 *
 * Returns both the raw streaming state and the derived plan/shimmer
 * values so the caller doesn't have to duplicate the content-check logic
 * for either one.
 */
export function useChatStreamingState(
  messages: {
    id?: string
    content: string
    role: string
    createdAt?: string
  }[],
  /**
   * Override the thread we subscribe to — split-mode columns pass their
   * own tab's threadId. If omitted, defaults to the globally-active thread
   * (original behavior).
   */
  explicitThreadId?: string | null,
  /**
   * When `includeShimmer: false`, the shimmer-phase timer is held at 0 and
   * never advances — the orchestrator hook passes this so shimmer ticks do
   * not cascade re-renders through prop-bag memos that don't consume it.
   * Downstream components (ChatColumn, ChatTranscript) call without
   * options and get the original shimmer-driving behavior.
   */
  options?: { includeShimmer?: boolean },
  activities: ThreadActivity[] = []
) {
  const activeThreadId = useChatStore((s) =>
    explicitThreadId === undefined ? s.activeThreadId : explicitThreadId
  )
  const isStreaming = useChatStore(
    (s) => getThreadStream(s, activeThreadId).isStreaming
  )
  const streamingText = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingText
  )
  const streamingPlanText = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingPlanText
  )
  const planStreamingFlag = useChatStore(
    (s) => getThreadStream(s, activeThreadId).isPlanStreaming
  )
  const reasoningText = useChatStore(
    (s) => getThreadStream(s, activeThreadId).reasoningText
  )
  const isReasoning = useChatStore(
    (s) => getThreadStream(s, activeThreadId).isReasoning
  )
  const reasoningSegments = useChatStore(
    (s) => getThreadStream(s, activeThreadId).reasoningSegments
  )
  const streamingTools = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingTools
  )
  const streamingTasks = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingTasks
  )
  const streamingDiffs = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingDiffs
  )
  const streamingModelId = useChatStore(
    (s) => getThreadStream(s, activeThreadId).streamingModelId
  )

  // Always call the hook (rules-of-hooks) but disable the phase timer when
  // the caller opts out — keeps the re-render cost at zero for consumers
  // that don't read shimmerPhase.
  const shimmerEnabled = options?.includeShimmer !== false
  const shimmerPhase = useShimmerPhase({
    isStreaming: shimmerEnabled ? isStreaming : false,
    hasStreamingContent: !!(
      streamingText ||
      streamingPlanText ||
      reasoningText ||
      isReasoning ||
      streamingTools.length > 0
    ),
  })

  // Persisted plans are derived from history only, so this scan (regex per
  // message + activity walk) re-runs only when messages/activities change — not
  // on every streamed token. The live streaming entry is appended separately
  // below so a normal reply into a long thread doesn't rescan the whole history
  // per frame.
  const persistedPlans = useMemo<PlanEntry[]>(() => {
    const out: PlanEntry[] = []
    const implementedPlans = new Map<
      string,
      { implementedAt?: string | null; implementationThreadId?: string | null }
    >()
    activities.forEach((activity) => {
      if (activity.kind !== "turn.proposed.implemented") return
      const payload = asRecord(activity.payload)
      const source = sourceProposedPlanFromPayload(payload)
      if (!source) return
      implementedPlans.set(sourceProposedPlanKey(source), {
        implementedAt:
          stringFrom(payload.implementedAt) ??
          stringFrom(payload.implemented_at),
        implementationThreadId:
          stringFrom(payload.implementationThreadId) ??
          stringFrom(payload.implementation_thread_id),
      })
    })
    messages.forEach((msg, idx) => {
      if (msg.role === "assistant" && isStructuredPlanMarkdown(msg.content)) {
        out.push({
          id: msg.id ?? `plan-${idx}`,
          content: msg.content,
          preview: buildPlanPreview(msg.content),
          createdAt: msg.createdAt,
          streaming: false,
        })
      }
    })

    activities.forEach((activity) => {
      const content = planContentFromActivity(activity)
      if (!content) return
      const sourceProposedPlan = sourceProposedPlanFromActivity(activity)
      const implementation = implementedPlans.get(
        sourceProposedPlanKey(sourceProposedPlan)
      )
      out.push({
        id: activity.id,
        content,
        preview: buildPlanPreview(content),
        createdAt: activity.createdAt,
        streaming: false,
        sourceProposedPlan,
        implemented: Boolean(implementation),
        implementedAt: implementation?.implementedAt ?? null,
        implementationThreadId: implementation?.implementationThreadId ?? null,
      })
    })

    out.sort((left, right) => {
      if (!left.createdAt || !right.createdAt) return 0
      return left.createdAt.localeCompare(right.createdAt)
    })
    return out
  }, [messages, activities])

  const allPlans = useMemo<PlanEntry[]>(() => {
    if (streamingPlanText) {
      return [
        ...persistedPlans,
        {
          id: "plan-streaming",
          content: streamingPlanText,
          preview: buildPlanPreview(streamingPlanText),
          streaming: true,
        },
      ]
    }
    if (streamingText && isStructuredPlanMarkdown(streamingText)) {
      return [
        ...persistedPlans,
        {
          id: "plan-streaming",
          content: streamingText,
          preview: buildPlanPreview(streamingText),
          streaming: true,
        },
      ]
    }
    return persistedPlans
  }, [persistedPlans, streamingText, streamingPlanText])

  const latestPlanContent =
    allPlans.length > 0 ? allPlans[allPlans.length - 1].content : null
  const latestPlanPreviewMarkdown =
    allPlans.length > 0 ? allPlans[allPlans.length - 1].preview : ""

  // A plan is only "streaming" once the real <proposed_plan> boundary is
  // crossed (store flag set by turn.proposed.* events or the content prefix
  // detector). The old `isStructuredPlanMarkdown(streamingText)` disjunct
  // promoted preliminary narration containing a `## Tasks`/`## Overview`
  // header into a premature plan card while the agent was still narrating.
  const isPlanStreaming =
    isStreaming && (planStreamingFlag || !!streamingPlanText)

  return {
    activeThreadId,
    isStreaming,
    streamingText,
    streamingPlanText,
    reasoningText,
    reasoningSegments,
    isReasoning,
    streamingTools,
    streamingTasks,
    streamingDiffs,
    streamingModelId,
    planStreamingFlag,
    shimmerPhase,
    latestPlanContent,
    latestPlanPreviewMarkdown,
    isPlanStreaming,
    allPlans,
  }
}
