import type { ReasoningSegment } from "@/lib/chat/types"

export function combineStreamingReasoning(
  segments: ReadonlyArray<ReasoningSegment>,
  liveText: string
): { text: string; durationSeconds: number } {
  const texts: string[] = []
  let durationMs = 0
  for (const segment of segments) {
    if (!segment.text.trim()) continue
    texts.push(segment.text)
    if (segment.startedAt === null || segment.endedAt === null) continue
    const elapsed = segment.endedAt - segment.startedAt
    if (Number.isFinite(elapsed) && elapsed >= 0) durationMs += elapsed
  }
  if (liveText.trim()) texts.push(liveText)
  return { text: texts.join("\n\n"), durationSeconds: durationMs / 1000 }
}
