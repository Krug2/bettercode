import { expectTypeOf, it } from "vitest"
import type { AppState } from "./appState"

it("requires policy, admission coordination and durable dispatch in production", () => {
  type Runtime = Pick<
    AppState,
    "agentPermissions" | "threadTurnCoordinator" | "chatDispatches"
  >
  expectTypeOf<Runtime>().toEqualTypeOf<Required<Runtime>>()
})
