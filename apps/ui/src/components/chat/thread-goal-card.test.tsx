import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ThreadGoal } from "@/lib/chat/types"

const state = vi.hoisted(() => ({ goal: null as ThreadGoal | null, running: false }))
vi.mock("@/lib/chat-store", () => ({
  useChatStore: (select: (store: unknown) => unknown) => select({
    settingsByThread: { thread: { goal: state.goal } },
    streamingByThread: state.running ? { thread: { isStreaming: true } } : {},
    threads: [],
  }),
}))
import { ThreadGoalCard } from "./thread-goal-card"

function render(goal: ThreadGoal | null, running = false) {
  state.goal = goal
  state.running = running
  return renderToStaticMarkup(<ThreadGoalCard threadId="thread" handleSubmit={() => {}} />)
}

const base: ThreadGoal = {
  objective: "Finish migration", status: "active", startedAt: 1, updatedAt: 2, source: "betterc0de",
  providerKind: "codex", tokens: 1234, tokenBudget: 20000, timeUsedSeconds: 85,
}

describe("thread goal status", () => {
  it.each([
    ["blocked", "Goal blocked"], ["usageLimited", "Usage limit reached"],
    ["budgetLimited", "Token budget reached"], ["paused", "Goal paused"],
    ["achieved", "Goal achieved"], ["unknown", "Goal status unavailable"],
  ] as const)("renders %s without claiming active progress", (status, label) => {
    const html = render({ ...base, status })
    expect(html).toContain(label)
    expect(html).not.toContain("Goal in progress")
    expect(html).not.toContain('aria-label="Pause goal"')
  })

  it("shows provider accounting, not wall time since creation, and exposes collapse state", () => {
    const html = render(base)
    expect(html).toContain("1m 25s")
    expect(html).toContain(`${(1234).toLocaleString()} / ${(20000).toLocaleString()} tokens`)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-label="Pause goal"')
  })

  it("does not invent elapsed work for legacy goals or show a cleared goal", () => {
    expect(render({ ...base, timeUsedSeconds: undefined })).not.toContain("1m 25s")
    expect(render(null)).not.toContain('aria-label="Thread goal"')
  })

  it("keeps provider-native goals read-only instead of offering ineffective controls", () => {
    const html = render({ ...base, source: undefined })
    expect(html).not.toContain('aria-label="Pause goal"')
    expect(html).not.toContain('aria-label="Clear goal"')
    expect(html).not.toContain('aria-label="Edit goal"')
    expect(html).not.toContain('aria-label="Goal actions"')
    expect(html).toContain("Finish migration")
  })

  it("keeps a paused goal readable and makes the next action explicit", () => {
    const reason = "Backend restarted. Resume explicitly to continue with current permissions."
    const html = render({ ...base, status: "paused", turns: 0, lastReason: reason })
    expect(html).toContain(reason)
    expect(html).toContain('aria-label="Resume goal"')
    expect(html).toContain("Resume</button>")
    expect(html).toContain('aria-label="Goal actions"')
    expect(html).toContain('aria-controls=')
    expect(html).not.toContain("basis-full truncate")
    expect(html).not.toContain("line-clamp-3")
    expect(html).not.toContain("after:-inset")
  })

  it("uses composer chrome and shared controls without fixed status colors or a separate action footer", () => {
    const html = render({ ...base, status: "paused" })
    expect(html).toContain("bg-sidebar")
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="outline"')
    expect(html).not.toMatch(/text-(?:amber|emerald|yellow)-/)
    expect(html).not.toContain("bg-card")
    expect(html).not.toContain("border-t ")
    expect(html).not.toContain("bg-foreground text-background")
  })

  // The pause pill and the actions button sit on the card's dark chrome; a
  // transparent outline and a muted glyph vanished there.
  it("gives the pause and actions controls a visible fill on the card chrome", () => {
    const html = render({ ...base, status: "active" })
    const pause = buttonTag(html, "Pause goal")
    expect(pause).toContain("bg-foreground/10")
    expect(pause).not.toContain("bg-transparent")
    const pauseGlyph = html.match(/<svg[^>]*lucide-pause[^>]*>/)?.[0] ?? ""
    expect(pauseGlyph).toContain('fill="currentColor"')
    const actions = buttonTag(html, "Goal actions")
    expect(actions).toContain("bg-foreground/6")
    expect(actions).not.toContain("text-muted-foreground")
  })

  // The backend publishes a goal only when a cycle settles, so the stored
  // state says "Waiting to start" for the whole first turn.
  it("shows the running turn instead of 'Waiting to start' once the loop is working", () => {
    const html = render({ ...base, turns: 0, lastReason: "Waiting to start." }, true)
    expect(html).toContain("Turn 1")
    expect(html).toContain("Working on the first turn.")
    expect(html).not.toContain("Waiting to start.")
  })

  it("keeps the last report visible while a later turn runs", () => {
    const html = render({ ...base, turns: 2, lastReason: "Parser fixed; tests remain." }, true)
    expect(html).toContain("Turn 3")
    expect(html).toContain("Parser fixed; tests remain.")
  })

  it("does not claim a running turn for an idle or paused goal", () => {
    expect(render({ ...base, turns: 0, lastReason: "Waiting to start." })).toContain(
      "Waiting to start."
    )
    expect(render({ ...base, status: "paused", turns: 0 }, true)).not.toContain("Turn 1")
  })
})

function buttonTag(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`)
  )
  if (!match) throw new Error(`No button labelled ${label}`)
  return match[0]
}
