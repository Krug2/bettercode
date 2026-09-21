export interface SourceProposedPlanReference {
  threadId: string
  planId: string
}

export interface PlanModalPayload {
  content: string
  threadId?: string | null
  sourceProposedPlan?: SourceProposedPlanReference | null
  implemented?: boolean
  implementedAt?: string | null
  implementationThreadId?: string | null
}

export type PlanModalInput = string | PlanModalPayload | null

export type SetPlanModalContent = (input: PlanModalInput) => void

export function normalizePlanModalInput(
  input: PlanModalInput
): PlanModalPayload | null {
  if (input === null) return null
  if (typeof input === "string") {
    return { content: input, sourceProposedPlan: null }
  }
  return {
    content: input.content,
    ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
    sourceProposedPlan: input.sourceProposedPlan ?? null,
    implemented: input.implemented ?? false,
    implementedAt: input.implementedAt ?? null,
    implementationThreadId: input.implementationThreadId ?? null,
  }
}
