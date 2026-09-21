/**
 * Shift+Tab turns Plan mode on and off.
 *
 * It used to cycle through every chat mode, so reaching Plan meant tapping
 * until you landed on it and overshooting meant going all the way round. Plan
 * is the only mode that is genuinely a *state you switch into and back out of*,
 * so it gets a toggle.
 *
 * Toggling back returns to whatever you were in before — leaving Plan should
 * not silently drop you out of "Ask / Read-only" and into a mode that may
 * write. When nothing is remembered (fresh window, or Plan was already active
 * at startup) it falls back to Agent.
 */

export const PLAN_CHAT_MODE = "plan"
export const DEFAULT_CHAT_MODE = "agent"

export interface PlanToggleResult {
  /** The mode to switch to. */
  readonly next: string
  /**
   * The mode to remember as "where we came from", or null to forget.
   * Set when entering Plan, cleared when leaving it.
   */
  readonly remember: string | null
}

export function togglePlanMode(
  current: string | null | undefined,
  remembered?: string | null
): PlanToggleResult {
  const mode = current?.trim() || DEFAULT_CHAT_MODE

  if (mode === PLAN_CHAT_MODE) {
    const back = remembered?.trim()
    return {
      // Never "return" into Plan itself — that would make the toggle a no-op.
      next: back && back !== PLAN_CHAT_MODE ? back : DEFAULT_CHAT_MODE,
      remember: null,
    }
  }

  return { next: PLAN_CHAT_MODE, remember: mode }
}
