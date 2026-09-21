import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EditorChatStack } from "./editor-chat-stack"

describe("editor chat stack", () => {
  it.each([2, 3, 6])(
    "keeps %i conversations in one vertical column",
    (count) => {
      const ids = Array.from({ length: count }, (_, index) => `chat-${index}`)
      const html = renderToStaticMarkup(
        <EditorChatStack
          activeTabIds={ids}
          renderColumn={(id) => <div>{id}</div>}
        />
      )
      expect(html).toContain('aria-label="Stacked chats"')
      expect(html).toContain("grid-template-columns:minmax(0, 1fr)")
      expect(html).not.toContain("repeat(2")
      expect(html.match(/data-editor-chat-panel=/g)).toHaveLength(count)
      for (let index = 1; index < ids.length; index++) {
        expect(
          html.indexOf(`data-editor-chat-panel="${ids[index]}"`)
        ).toBeGreaterThan(
          html.indexOf(`data-editor-chat-panel="${ids[index - 1]}"`)
        )
      }
    }
  )
})
