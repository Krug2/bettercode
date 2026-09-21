import type { ChatQuestion } from "@/lib/chat-store"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Identify which line indices are top-level numbered questions (not indented sub-items). */
function findTopLevelQuestionLines(lines: string[]): Set<number> {
  const result = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim().replace(/\*\*/g, "")
    if (!line) continue
    // Top-level = at most 2 spaces of indentation
    const indent = raw.length - raw.trimStart().length
    if (indent > 2) continue
    const numMatch = line.match(/^\d+[.)]\s+(.+)/)
    if (!numMatch) continue
    const body = numMatch[1].trim()
    if (body.endsWith("?") || body.endsWith(":")) {
      result.add(i)
    }
  }
  return result
}

/** Try to parse inline parenthesized options — "Question? (A, B, C)" */
function parseInlineParenOptions(
  line: string
): { questionText: string; options: string[] } | null {
  const parenMatch = line.match(/^(?:\d+[.)]\s*)?(.+\?)\s*\(([^)]+)\)/)
  if (!parenMatch) return null
  const questionText = parenMatch[1].trim()
  const options = parenMatch[2]
    .split(/,\s*/)
    .map((o) => o.trim())
    .filter(
      (o) => o.length > 0 && !o.match(/^etc\.?$/i) && !o.match(/^\.\.\.$/)
    )
  if (options.length >= 2) return { questionText, options }
  return null
}

/** Collect sub-item labels (bullets, numbered, lettered) following a question line. */
function parseSubOptions(
  lines: string[],
  startAfter: number,
  topLevelQuestionLines: Set<number>,
  consumed: Set<number>
): string[] {
  const subOptions: string[] = []
  for (let j = startAfter; j < lines.length && j < startAfter + 19; j++) {
    if (topLevelQuestionLines.has(j)) break // next top-level question
    const sub = lines[j].trim().replace(/\*\*/g, "")
    if (!sub) {
      if (subOptions.length > 0) break
      continue
    }
    if (sub.startsWith("##") || sub.startsWith("# ")) break

    // Bullet: "- text", "* text", "* text"
    const bulletMatch = sub.match(/^[-\u2022*]\s+(.+)/)
    if (bulletMatch) {
      const label = bulletMatch[1].trim().replace(/\?$/, "").trim()
      if (label.length > 0 && label.length < 120) {
        subOptions.push(label)
        consumed.add(j)
      }
      continue
    }

    // Numbered sub-option: "1. text", "2) text"
    const subNumMatch = sub.match(/^\d+[.)]\s+(.+)/)
    if (subNumMatch) {
      const label = subNumMatch[1].trim().replace(/\?$/, "").trim()
      if (label.length > 0 && label.length < 120) {
        subOptions.push(label)
        consumed.add(j)
      }
      continue
    }

    // Letter sub-option: "a) text"
    const letterMatch = sub.match(/^[a-z][.)]\s+(.+)/i)
    if (letterMatch) {
      const label = letterMatch[1].trim().replace(/\?$/, "").trim()
      if (label.length > 0 && label.length < 120) {
        subOptions.push(label)
        consumed.add(j)
      }
      continue
    }

    // Short plain text after options — stop
    break
  }
  return subOptions
}

/** Extract selectable options from inline text patterns like "A oder B" / "A or B". */
export function extractInlineOptions(text: string): string[] {
  // Remove bold markdown and leading "Title -- " prefix
  const clean = text
    .replace(/\*\*/g, "")
    .replace(/^[^—–-]+[—–-]\s*/, "")
    .trim()

  // Pattern 1: Multiple parenthesized groups as options
  // e.g., "Singleplayer (gegen KI) oder Multiplayer (lokal)?"
  const parenGroups = clean.match(/([^(]+?)\s*\(([^)]+)\)/g)
  if (parenGroups && parenGroups.length >= 2) {
    const options = parenGroups
      .map((g) => {
        const m = g.match(/([^(]+?)\s*\(([^)]+)\)/)
        return m ? `${m[1].trim()} (${m[2].trim()})` : g.trim()
      })
      .map((o) =>
        o
          .replace(/^,?\s*oder\s+/i, "")
          .replace(/^,?\s*or\s+/i, "")
          .replace(/^\s*,\s*/, "")
          .trim()
      )
      .filter((o) => o.length > 0 && o.length < 60)
    if (options.length >= 2) return options.slice(0, 5)
  }

  // Pattern 2: "A oder B oder C" / "A or B or C"
  const oderSplit = clean.replace(/\?$/, "").split(/\s+oder\s+|\s+or\s+/i)
  if (oderSplit.length >= 2) {
    const options = oderSplit
      .map((o) => o.trim().replace(/^,\s*/, "").replace(/\.$/, "").trim())
      .filter((o) => o.length > 2 && o.length < 60)
    if (options.length >= 2) return options.slice(0, 5)
  }

  return []
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/** Parse questions from assistant text -- no AI, pure local parsing.
 *
 *  Accepts a `makeId` callback so callers can supply their own id generator
 *  (defaults to `crypto.randomUUID()`).
 */
export function parseQuestionsFromText(
  text: string,
  makeId: () => string = () => crypto.randomUUID()
): ChatQuestion[] {
  const questions: ChatQuestion[] = []
  const lines = text.split("\n")
  const consumed = new Set<number>() // line indices already part of a question block

  // First pass: identify top-level numbered question lines
  const topLevelQuestionLines = findTopLevelQuestionLines(lines)

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue
    const raw = lines[i]
    const line = raw.trim().replace(/\*\*/g, "")
    if (!line) continue

    // Pattern 1: Inline options -- "Question? (Option1, Option2, Option3)"
    const inlineParen = parseInlineParenOptions(line)
    if (inlineParen) {
      consumed.add(i)
      questions.push({
        id: makeId(),
        text: inlineParen.questionText,
        options: inlineParen.options.map((o) => ({ label: o })),
      })
      continue
    }

    // Pattern 2: Top-level numbered question followed by sub-items as options
    if (!topLevelQuestionLines.has(i)) continue

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)/)
    if (!numberedMatch) continue
    const questionBody = numberedMatch[1].trim()
    if (questionBody.length > 150) continue

    // Collect sub-items
    const subOptions = parseSubOptions(
      lines,
      i + 1,
      topLevelQuestionLines,
      consumed
    )

    // Clean question text: remove trailing colon, ensure question mark
    let cleanQuestion = questionBody.replace(/:$/, "").trim()
    if (!cleanQuestion.endsWith("?")) cleanQuestion += "?"

    if (subOptions.length >= 2) {
      consumed.add(i)
      questions.push({
        id: makeId(),
        text: cleanQuestion,
        options: subOptions.map((o) => ({ label: o })),
      })
      continue
    }

    // Fallback: single-line question with "A or B" style inline options
    const fallbackOptions = extractInlineOptions(questionBody)
    if (fallbackOptions.length >= 2) {
      consumed.add(i)
      questions.push({
        id: makeId(),
        text: cleanQuestion,
        options: fallbackOptions.map((o) => ({ label: o })),
      })
    }
  }

  return questions
}
