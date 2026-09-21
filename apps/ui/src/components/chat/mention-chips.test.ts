import { describe, expect, it } from "vitest"
import { extractComposerInlineChips } from "@/components/chat/mention-chips"

describe("extractComposerInlineChips", () => {
  it("extracts unique file mentions and known provider skills", () => {
    expect(
      extractComposerInlineChips(
        "Use @src/app.ts with $gh-fix-ci and @src/app.ts",
        [
          {
            name: "gh-fix-ci",
            displayName: "Fix CI",
          },
        ],
      ),
    ).toEqual({
      mentions: ["src/app.ts"],
      skills: [{ name: "gh-fix-ci", displayName: "Fix CI" }],
    })
  })

  it("ignores unknown provider skill tokens", () => {
    expect(
      extractComposerInlineChips("Use $missing", [
        {
          name: "gh-fix-ci",
        },
      ]),
    ).toEqual({
      mentions: [],
      skills: [],
    })
  })
})
