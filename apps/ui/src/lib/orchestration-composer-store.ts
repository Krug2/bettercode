import { create } from "zustand"
import {
  chatOrchestrationSchema,
  type ChatOrchestration,
} from "@betterc0de/schema"

export const ORCHESTRATION_OFF: ChatOrchestration = { enabled: false }
/** Only the unsent, thread-less composer draft. Never inherited by another chat. */
export const useOrchestrationDraft = create<{
  selection: ChatOrchestration
  set: (selection: ChatOrchestration) => void
}>((set) => ({
  selection: ORCHESTRATION_OFF,
  set: (selection) =>
    set({ selection: chatOrchestrationSchema.parse(selection) }),
}))

export function savedOrchestration(value: unknown): ChatOrchestration {
  const parsed = chatOrchestrationSchema.safeParse(value)
  return parsed.success ? parsed.data : ORCHESTRATION_OFF
}
