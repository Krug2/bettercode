import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatMessageItem } from "@/components/chat/chat-message-item"
import type { ChatMessage } from "@/lib/chat-store"

/**
 * The answer time has to be readable without hovering. It first shipped inside
 * the actions toolbar, which fades in on hover, so how long a turn took was
 * only discoverable by pointing at it — and a touch client never could.
 *
 * These tests assert the *structure* that keeps it visible, because "renders
 * the text somewhere" would have passed for the broken version too.
 */

const HOVER_FADE = "opacity-0"

function message(
  role: ChatMessage["role"],
  createdAt: string,
  content: string
): ChatMessage {
  return { id: `${role}-${createdAt}`, role, content, createdAt } as ChatMessage
}

function renderTurn(messages: ChatMessage[], idx: number): string {
  return renderToStaticMarkup(
    <ChatMessageItem
      msg={messages[idx]}
      idx={idx}
      messages={messages}
      activeThreadId="thread-1"
      onRetry={() => {}}
      onOpenConfirm={() => {}}
      onOpenPlanModal={() => {}}
    />
  )
}

/** The markup of the hover-faded actions container itself. */
function hoverBlock(html: string): string {
  const start = html.indexOf(HOVER_FADE)
  if (start === -1) return ""
  const tail = html.slice(start)
  return tail.slice(0, tail.indexOf("</div>"))
}

const ANSWERED_IN_90_SECONDS = [
  message("user", "2026-08-23T10:00:00.000Z", "add a test"),
  message("assistant", "2026-08-23T10:01:30.000Z", "Done."),
]

describe("turn duration under an answer", () => {
  it("shows how long the turn took, with a clock", () => {
    const html = renderTurn(ANSWERED_IN_90_SECONDS, 1)
    expect(html).toContain("Total time for this turn")
    expect(html).toContain("1m 30s")
    expect(html).toContain("lucide-clock")
  })

  it("keeps the duration outside the hover-faded actions block", () => {
    // If the duration is ever moved back inside MessageActions, it inherits
    // `opacity-0` and vanishes until hover.
    const html = renderTurn(ANSWERED_IN_90_SECONDS, 1)
    expect(html).toContain(HOVER_FADE)
    expect(hoverBlock(html)).not.toContain("Total time for this turn")
  })

  it("puts the duration before the actions so it sits flush left", () => {
    // `opacity-0` hides the actions but keeps their layout box. With the
    // duration rendered after them it was pushed right by the width of buttons
    // nobody could see, which is what made it look randomly indented.
    const html = renderTurn(ANSWERED_IN_90_SECONDS, 1)
    expect(html.indexOf("Total time for this turn")).toBeLessThan(
      html.indexOf(HOVER_FADE)
    )
  })

  it("says nothing when the turn cannot be measured honestly", () => {
    // A restored history whose assistant stamp predates the user stamp would
    // otherwise render a negative or absurd number.
    const reversed = [
      message("user", "2026-08-23T10:01:30.000Z", "add a test"),
      message("assistant", "2026-08-23T10:00:00.000Z", "Done."),
    ]
    expect(renderTurn(reversed, 1)).not.toContain("Total time for this turn")
  })

  it("shows no duration on the user's own message", () => {
    expect(renderTurn(ANSWERED_IN_90_SECONDS, 0)).not.toContain(
      "Total time for this turn"
    )
  })
})
