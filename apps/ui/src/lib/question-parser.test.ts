import { describe, it, expect } from "vitest"
import {
  parseQuestionsFromText,
  extractInlineOptions,
} from "@/lib/question-parser"

// Deterministic id generator for assertions
let idCounter = 0
const makeId = () => `q-${++idCounter}`

function parse(text: string) {
  idCounter = 0
  return parseQuestionsFromText(text, makeId)
}

// ---------------------------------------------------------------------------
// Simple numbered questions
// ---------------------------------------------------------------------------
describe("simple numbered questions", () => {
  it("parses two numbered questions with bullet options", () => {
    const result = parse(
      [
        "1. Should we use React?",
        "- Yes",
        "- No",
        "2. Should we use TypeScript?",
        "- Yes",
        "- No",
      ].join("\n")
    )
    expect(result).toHaveLength(2)
    expect(result[0].text).toBe("Should we use React?")
    expect(result[0].options.map((o) => o.label)).toEqual(["Yes", "No"])
    expect(result[1].text).toBe("Should we use TypeScript?")
    expect(result[1].options.map((o) => o.label)).toEqual(["Yes", "No"])
  })

  it("handles ')' numbered format", () => {
    const result = parse(
      [
        "1) Which database?",
        "- Postgres",
        "- SQLite",
        "- MySQL",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Which database?")
    expect(result[0].options).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Questions with sub-options (indented bullets under a question)
// ---------------------------------------------------------------------------
describe("questions with sub-options", () => {
  it("collects bullet sub-items as options", () => {
    const result = parse(
      [
        "1. Which framework should we use?",
        "- React",
        "- Vue",
        "- Svelte",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].options.map((o) => o.label)).toEqual([
      "React",
      "Vue",
      "Svelte",
    ])
  })

  it("collects numbered sub-items as options", () => {
    const result = parse(
      [
        "1. Which color scheme?",
        "1. Light mode",
        "2. Dark mode",
        "3. Auto",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Light mode",
      "Dark mode",
      "Auto",
    ])
  })

  it("collects letter sub-items as options", () => {
    const result = parse(
      [
        "1. Which testing framework?",
        "a) Vitest",
        "b) Jest",
        "c) Mocha",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Vitest",
      "Jest",
      "Mocha",
    ])
  })

  it("strips trailing ? from sub-option labels", () => {
    const result = parse(
      [
        "1. What should we prioritize?",
        "- Performance?",
        "- Readability?",
      ].join("\n")
    )
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Performance",
      "Readability",
    ])
  })
})

// ---------------------------------------------------------------------------
// Questions ending with ? vs :
// ---------------------------------------------------------------------------
describe("question ending with ? vs :", () => {
  it("preserves ? ending", () => {
    const result = parse(
      ["1. Should we refactor?", "- Yes", "- No"].join("\n")
    )
    expect(result[0].text).toBe("Should we refactor?")
  })

  it("converts : ending to ?", () => {
    const result = parse(
      ["1. Pick a strategy:", "- Strategy A", "- Strategy B"].join("\n")
    )
    expect(result[0].text).toBe("Pick a strategy?")
  })
})

// ---------------------------------------------------------------------------
// Mixed content (paragraphs + questions)
// ---------------------------------------------------------------------------
describe("mixed content", () => {
  it("ignores non-question paragraphs and extracts questions", () => {
    const result = parse(
      [
        "Here is my analysis of the codebase.",
        "",
        "The architecture looks solid overall.",
        "",
        "1. Should we add caching?",
        "- Yes, with Redis",
        "- No, keep it simple",
        "",
        "Let me know what you think.",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Should we add caching?")
  })

  it("extracts multiple questions from mixed content", () => {
    const result = parse(
      [
        "I have a few questions:",
        "",
        "1. Which bundler?",
        "- Vite",
        "- Webpack",
        "",
        "Some more context here.",
        "",
        "2. Which package manager?",
        "- npm",
        "- pnpm",
        "- yarn",
      ].join("\n")
    )
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("edge cases", () => {
  it("returns empty array for empty text", () => {
    expect(parse("")).toEqual([])
  })

  it("returns empty array when no questions exist", () => {
    expect(parse("This is just a paragraph.\nNothing special here.")).toEqual([])
  })

  it("returns empty array for numbered lines without ? or : ending", () => {
    // "1. Install the package" is a step, not a question
    expect(parse("1. Install the package\n2. Run the tests")).toEqual([])
  })

  it("handles a single question", () => {
    const result = parse(
      ["1. Should we proceed?", "- Yes", "- No"].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Should we proceed?")
  })

  it("strips **bold** markdown from question text", () => {
    const result = parse(
      ["1. **Should we refactor?**", "- Yes", "- No"].join("\n")
    )
    expect(result[0].text).toBe("Should we refactor?")
  })

  it("strips **bold** markdown from option labels", () => {
    const result = parse(
      ["1. Choose one?", "- **Option A**", "- **Option B**"].join("\n")
    )
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Option A",
      "Option B",
    ])
  })

  it("skips questions with body longer than 150 chars", () => {
    const longBody = "A".repeat(151) + "?"
    const result = parse(
      [`1. ${longBody}`, "- Yes", "- No"].join("\n")
    )
    expect(result).toEqual([])
  })

  it("requires at least 2 sub-options to form a question", () => {
    const result = parse(
      ["1. What should we do?", "- Only one option"].join("\n")
    )
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Nested numbered lists — sub-items should NOT be treated as top-level questions
// ---------------------------------------------------------------------------
describe("nested numbered lists", () => {
  it("indented numbered items are sub-options, not top-level questions", () => {
    const result = parse(
      [
        "1. Which approach?",
        "   1. Use microservices",
        "   2. Use monolith",
        "2. Which database?",
        "   - Postgres",
        "   - MongoDB",
      ].join("\n")
    )
    // Both top-level questions should be parsed;
    // the indented items should be options, not separate questions
    expect(result).toHaveLength(2)
    expect(result[0].text).toBe("Which approach?")
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Use microservices",
      "Use monolith",
    ])
    expect(result[1].text).toBe("Which database?")
    expect(result[1].options.map((o) => o.label)).toEqual([
      "Postgres",
      "MongoDB",
    ])
  })

  it("does not treat deeply indented question-like text as top-level", () => {
    const result = parse(
      [
        "1. Main question?",
        "    1. Sub-item one that ends with a colon:",
        "    2. Sub-item two",
      ].join("\n")
    )
    // The indented items should be options of the main question
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Main question?")
  })
})

// ---------------------------------------------------------------------------
// Inline parenthesized options — "Question? (A, B, C)"
// ---------------------------------------------------------------------------
describe("inline parenthesized options", () => {
  it("parses 'Question? (A, B, C)' format", () => {
    const result = parse("Should we use tabs or spaces? (Tabs, Spaces)")
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Should we use tabs or spaces?")
    expect(result[0].options.map((o) => o.label)).toEqual(["Tabs", "Spaces"])
  })

  it("filters out 'etc.' but keeps remaining valid options", () => {
    const result = parse("Which format? (JSON, YAML, etc.)")
    // "etc." is filtered, but JSON + YAML remain (>= 2), so the question is valid
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Which format?")
    expect(result[0].options.map((o) => o.label)).toEqual(["JSON", "YAML"])
  })

  it("works with numbered prefix", () => {
    const result = parse("1. Which mode? (Light, Dark, Auto)")
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Which mode?")
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Light",
      "Dark",
      "Auto",
    ])
  })
})

// ---------------------------------------------------------------------------
// extractInlineOptions (the helper for "A or B" patterns)
// ---------------------------------------------------------------------------
describe("extractInlineOptions", () => {
  it("splits 'A or B' pattern", () => {
    const options = extractInlineOptions("React or Vue?")
    expect(options).toEqual(["React", "Vue"])
  })

  it("splits 'A oder B' pattern (German)", () => {
    const options = extractInlineOptions("Tabs oder Spaces?")
    expect(options).toEqual(["Tabs", "Spaces"])
  })

  it("splits 'A or B or C' pattern", () => {
    const options = extractInlineOptions("npm or pnpm or yarn?")
    expect(options).toEqual(["npm", "pnpm", "yarn"])
  })

  it("returns empty for text without options", () => {
    expect(extractInlineOptions("Just a plain sentence.")).toEqual([])
  })

  it("handles parenthesized groups as options", () => {
    const options = extractInlineOptions(
      "Singleplayer (gegen KI) oder Multiplayer (lokal)?"
    )
    expect(options).toHaveLength(2)
    expect(options[0]).toContain("Singleplayer")
    expect(options[1]).toContain("Multiplayer")
  })
})

// ---------------------------------------------------------------------------
// Heading boundaries stop sub-option collection
// ---------------------------------------------------------------------------
describe("heading boundaries", () => {
  it("stops collecting options at a ## heading", () => {
    const result = parse(
      [
        "1. Which tool?",
        "- Tool A",
        "- Tool B",
        "## Next section",
        "- Not an option",
      ].join("\n")
    )
    expect(result).toHaveLength(1)
    expect(result[0].options).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Fallback inline "or" question (top-level numbered, no sub-items)
// ---------------------------------------------------------------------------
describe("fallback inline or-question", () => {
  it("extracts options from 'A or B' in a numbered question line", () => {
    const result = parse("1. Should we use Vitest or Jest?")
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe("Should we use Vitest or Jest?")
    // extractInlineOptions splits on "or", so the left side includes the full prefix
    expect(result[0].options.map((o) => o.label)).toEqual([
      "Should we use Vitest",
      "Jest",
    ])
  })
})
