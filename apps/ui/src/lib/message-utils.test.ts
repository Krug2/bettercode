import React from "react"
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
  isAskSlashCommand,
  isDebugSlashCommand,
  isDefaultSlashCommand,
  isPlanSlashCommand,
  isSecuritySlashCommand,
  renderMessageWithMentions,
} from "@/lib/message-utils"

describe("mode slash commands", () => {
  it("detects plan and default mode slash commands", () => {
    expect(isPlanSlashCommand("/plan build a safe plan")).toBe(true)
    expect(isPlanSlashCommand(" /PLAN")).toBe(true)
    expect(isPlanSlashCommand("/planet")).toBe(false)

    expect(isAskSlashCommand("/ask explain this")).toBe(true)
    expect(isAskSlashCommand("/asking")).toBe(false)
    expect(isSecuritySlashCommand("/security audit auth")).toBe(true)
    expect(isSecuritySlashCommand("/securityreview")).toBe(false)
    expect(isDebugSlashCommand("/debug failing test")).toBe(true)
    expect(isDebugSlashCommand("/debugging")).toBe(false)

    expect(isDefaultSlashCommand("/default")).toBe(true)
    expect(isDefaultSlashCommand(" /DEFAULT now")).toBe(true)
    expect(isDefaultSlashCommand("/build")).toBe(true)
    expect(isDefaultSlashCommand("/agent-mode")).toBe(true)
    expect(isDefaultSlashCommand("/agent")).toBe(false)
    expect(isDefaultSlashCommand("/defaulting")).toBe(false)
  })
})

describe("renderMessageWithMentions", () => {
  it("renders known provider skills as inline skill labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        renderMessageWithMentions("Use $gh-fix-ci for @src/app.ts", [
          {
            name: "gh-fix-ci",
            displayName: "Fix CI",
          },
        ])
      )
    )

    expect(html).toContain('class="skill-label"')
    expect(html).toContain("Fix CI")
    expect(html).toContain('class="mention-label"')
    expect(html).toContain("@src/app.ts")
  })

  it("leaves unknown provider skill tokens as plain text", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        renderMessageWithMentions("Use $missing", [])
      )
    )

    expect(html).toBe("Use $missing")
  })
})
