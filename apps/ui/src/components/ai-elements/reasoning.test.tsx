import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Reasoning, ReasoningTrigger } from "./reasoning"

describe("reasoning status", () => {
  it.each([[0.36, "360ms"], [6, "6.0s"]])(
    "keeps a completed %ss phase stopped",
    (duration, label) => {
      const html = renderToStaticMarkup(
        <Reasoning isStreaming={false} duration={Number(duration)} defaultOpen={false}>
          <ReasoningTrigger />
        </Reasoning>
      )
      expect(html).toContain(`Thought for ${label}`)
      expect(html).not.toContain("Thinking")
      expect(html).toContain('aria-expanded="false"')
    }
  )

  it("does not show a misleading zero-duration label", () => {
    const html = renderToStaticMarkup(
      <Reasoning isStreaming={false} duration={0} defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(html).toContain("Thought")
    expect(html).not.toContain("0ms")
    expect(html).not.toContain("Thinking")
  })

  it("labels only an active phase as thinking", () => {
    const html = renderToStaticMarkup(<Reasoning isStreaming><ReasoningTrigger /></Reasoning>)
    expect(html).toContain("Thinking...")
    expect(html).not.toContain("Thought for")
  })
})
