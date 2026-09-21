import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MessageResponse } from "./message"

describe("message Markdown", () => {
  it("keeps loose lists semantic and source references inline and accessible", () => {
    const html = renderToStaticMarkup(
      <MessageResponse>
        {
          "1. **First finding**\n\n   Details in `src/app/page.tsx:12`.\n\n2. Second finding with `Promise.race` at `127.0.0.1`."
        }
      </MessageResponse>
    )
    expect(html).toContain("message-response")
    expect(html).toContain("<ol")
    expect(html).toContain("<li")
    expect(html).toContain("message-source-link")
    expect(html).toContain("Open src/app/page.tsx:12")
    expect(html).toContain("Promise.race")
    expect(html).not.toContain("Open Promise.race")
    expect(html).not.toContain("Open 127.0.0.1")
    expect(html).not.toContain("font-mono text-sm")
    const commands = renderToStaticMarkup(
      <MessageResponse>
        {"Use `/`, `/skills --json` or `/<skill-id>`."}
      </MessageResponse>
    )
    expect(commands).not.toContain("message-source-link")
  })
  it("renders table controls with a bounded keyboard-accessible scroll region", () => {
    const html = renderToStaticMarkup(
      <MessageResponse>
        {
          "| Skill | Invocation |\n| --- | --- |\n| Code review | `@codex-skill-review` |"
        }
      </MessageResponse>
    )
    expect(html).toContain("message-table-scroll")
    expect(html).toContain("Copy table")
    expect(html).toContain("Expand table")
    expect(html).toContain('tabindex="0"')
    expect(html).toContain("@codex-skill-review")
  })
})
