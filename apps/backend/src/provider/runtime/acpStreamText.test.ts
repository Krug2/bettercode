import fs from "node:fs"
import path from "node:path"
import { readString } from "@betterc0de/schema"
import { describe, expect, it } from "vitest"

/**
 * Streamed assistant text used to be read with the same trimming helper as ids
 * and mode names. Models stream " local" and " changes." as separate chunks,
 * so trimming each one concatenated them into "Reviewinglocalchanges." — every
 * word in a Grok or Cursor answer ran into the next.
 *
 * The ACP runtime shared by Grok and Cursor reads chunks with the untrimmed
 * `readString`; the first block pins that the trimming reader never comes
 * back at the two streaming sites, the rest pins `readString` itself.
 */
describe("acp streamed text sites", () => {
  it("read agent and thought chunks with the untrimmed reader", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "acp/AcpRuntimeBase.ts"),
      "utf8"
    )
    // The two `session/update` chunk cases, each up to its emit.
    const chunkCases = source.match(
      /case "agent_(?:thought|message)_chunk": \{[\s\S]*?read\w+\(content, "text"\)/g
    ) ?? []
    expect(chunkCases).toHaveLength(2)
    for (const block of chunkCases) {
      expect(block).toContain('readString(content, "text")')
      expect(block).not.toContain("readTrimmed(")
    }
  })
})

describe.each([["shared", readString]])("%s streamed text reader", (_name, textField) => {
  it("preserves the leading space that separates two chunks", () => {
    expect(textField({ text: " local" }, "text")).toBe(" local")
    expect(textField({ text: "changes. " }, "text")).toBe("changes. ")
  })

  it("keeps a chunk that is only whitespace", () => {
    // A lone space is the word break itself; dropping it is the bug.
    expect(textField({ text: " " }, "text")).toBe(" ")
    expect(textField({ text: "\n" }, "text")).toBe("\n")
  })

  it("preserves newlines and indentation inside a chunk", () => {
    expect(textField({ text: "\n\n  const x = 1\n" }, "text")).toBe(
      "\n\n  const x = 1\n"
    )
  })

  it("reassembles a sentence exactly as streamed", () => {
    const chunks = ["Reviewing", " local", " changes", "."]
    const joined = chunks
      .map((text) => textField({ text }, "text") ?? "")
      .join("")
    expect(joined).toBe("Reviewing local changes.")
  })

  it("ignores absent and non-string values", () => {
    expect(textField({}, "text")).toBeUndefined()
    expect(textField({ text: "" }, "text")).toBeUndefined()
    expect(textField({ text: 42 }, "text")).toBeUndefined()
    expect(textField({ text: null }, "text")).toBeUndefined()
  })
})
