import type { AppState } from "../../appState"
import type { ThreadGoals } from "./goals"
import type { ChatSendBody } from "@betterc0de/schema"
import type { RemoteProviderTurnReservation } from "../../remote/providerTurnOwnership"

export interface GoalContext {
  body: ChatSendBody
  reserveRemoteTurn: () => RemoteProviderTurnReservation | null
  continued?: boolean
}
export const threadGoals = new WeakMap<AppState, ThreadGoals<GoalContext>>()
