import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { StreamingMessage } from "./streaming-message"
import { ChatMessageItem } from "./chat-message-item"
import type { ChatMessage } from "@betterc0de/schema"

const base: ComponentProps<typeof StreamingMessage> = {
  streamingText: "", streamingPlanText: "",
  streamingTools: [], streamingDiffs: [], streamingTasks: [],
  reasoningText: "", isReasoning: false, isPlanStreaming: false,
  chatMode: "agent", shimmerPhase: 0,
  onOpenPlanModal: () => {},
  reasoningSegments: [
    { id: "first", text: "Read the source.", startedAt: 0, endedAt: 0 },
    { id: "second", text: "Check the tests.", startedAt: 1000, endedAt: 3000 },
    { id: "third", text: "Review the patch.", startedAt: 10_000, endedAt: 14_000 },
  ],
}

function render(patch: Partial<typeof base> = {}) {
  return renderToStaticMarkup(<StreamingMessage {...base} {...patch} />)
}

describe("streaming thinking disclosure", () => {
  it("shows the model once per turn, including while the answer is pending", () => {
    const userMessage: ChatMessage = {
      id: "user-1", role: "user", content: "Hi", modelId: "test-turn-model",
      createdAt: "2026-09-19T12:00:00Z",
    }
    // The streaming state still knows the model; its view must not repeat
    // metadata already owned by the persisted turn header.
    const streamingState = { ...base, reasoningSegments: [], streamingModelId: userMessage.modelId }
    const html = renderToStaticMarkup(<>
      <ChatMessageItem msg={userMessage} idx={0} messages={[userMessage]}
        activeThreadId="thread-1" onRetry={() => {}} onOpenConfirm={() => {}} onOpenPlanModal={() => {}} />
      <StreamingMessage {...streamingState} />
    </>)
    expect(html.match(/test-turn-model/g)).toHaveLength(1)
    expect(html).toContain("Thinking...")
  })

  it("shows an animated waiting status only until the first answer arrives", () => {
    const waiting = render({ reasoningSegments: [] })
    expect(waiting).toContain('role="status"')
    expect(waiting).toContain('data-agent-orb="breathing"')
    expect(waiting).toContain("Thinking...")
    const answering = render({ reasoningSegments: [], streamingText: "Here is the answer." })
    expect(answering).not.toContain("data-agent-orb")
    expect(answering).toContain("Here is the answer.")
  })

  it("keeps a slow response indeterminate instead of claiming it is almost finished", () => {
    const html = render({ reasoningSegments: [], shimmerPhase: 4 })
    expect(html).toContain("Still working...")
    expect(html).not.toContain("almost there")
  })

  it("renders one collapsed component with total thinking time", () => {
    const html = render()
    expect(html.match(/data-slot="turn-reasoning"/g)).toHaveLength(1)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1)
    expect(html).toContain("Thought for 6.0s")
    expect(html).not.toContain("0ms")
    expect(html).not.toContain("Thinking...")
    expect(html).not.toContain("data-agent-orb")
  })

  it("puts the live phase in the same component and continues the total timer", () => {
    const html = render({ reasoningText: "One more check.", isReasoning: true })
    expect(html.match(/data-slot="turn-reasoning"/g)).toHaveLength(1)
    expect(html).toContain("Thinking 6s")
    expect(html).not.toContain("Thought for")
    expect(html.match(/data-agent-orb="solving"/g)).toHaveLength(1)
  })

  it("keeps the summary setting to one header for the entire turn", () => {
    const html = render({ showReasoningSummaries: true })
    expect(html.match(/data-slot="turn-reasoning"/g)).toHaveLength(1)
    expect(html).toContain("Read the source.")
    expect(html).not.toContain("Check the tests.")
  })

  it("respects hidden thinking and does not render a block for empty segments", () => {
    expect(render({ showThinking: false })).not.toContain('data-slot="turn-reasoning"')
    expect(render({ reasoningSegments: [], streamingText: "Done." })).not.toContain('data-slot="turn-reasoning"')
  })
})
