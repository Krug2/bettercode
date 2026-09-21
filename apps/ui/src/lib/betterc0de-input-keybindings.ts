export type BetterC0deInputShortcut =
  | "clear"
  | "delete-character"
  | "delete-line"
  | "delete-to-line-end"
  | "delete-to-line-start"
  | "newline"

export interface TextInputSnapshot {
  value: string
  selectionStart: number
  selectionEnd: number
}

export interface TextInputEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

export interface KeyEventSnapshot {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function resolveBetterC0deInputShortcut(
  event: KeyEventSnapshot,
  input: TextInputSnapshot
): BetterC0deInputShortcut | null {
  const key = event.key.toLowerCase()
  const hasSelection = input.selectionStart !== input.selectionEnd

  if (event.key === "Enter") {
    if (event.shiftKey || event.ctrlKey || event.altKey) return "newline"
    return null
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    if (key === "j") return "newline"
    if (!event.shiftKey && key === "c" && !hasSelection && input.value) {
      return "clear"
    }
    if (!event.shiftKey && key === "d") return "delete-character"
    if (event.shiftKey && key === "d") return "delete-line"
    if (!event.shiftKey && key === "k") return "delete-to-line-end"
    if (!event.shiftKey && key === "u") return "delete-to-line-start"
  }

  return null
}

export function applyBetterC0deInputShortcut(
  input: TextInputSnapshot,
  shortcut: BetterC0deInputShortcut
): TextInputEdit {
  switch (shortcut) {
    case "clear":
      return { value: "", selectionStart: 0, selectionEnd: 0 }
    case "delete-character":
      return deleteRangeOrForwardCharacter(input)
    case "delete-line":
      return deleteCurrentLine(input)
    case "delete-to-line-end":
      return deleteToLineEnd(input)
    case "delete-to-line-start":
      return deleteToLineStart(input)
    case "newline":
      return replaceSelection(input, "\n")
  }
}

function replaceSelection(
  input: TextInputSnapshot,
  replacement: string
): TextInputEdit {
  const start = clampSelection(input.selectionStart, input.value)
  const end = clampSelection(input.selectionEnd, input.value)
  const rangeStart = Math.min(start, end)
  const rangeEnd = Math.max(start, end)
  const value =
    input.value.slice(0, rangeStart) + replacement + input.value.slice(rangeEnd)
  const cursor = rangeStart + replacement.length
  return { value, selectionStart: cursor, selectionEnd: cursor }
}

function deleteRangeOrForwardCharacter(
  input: TextInputSnapshot
): TextInputEdit {
  const start = clampSelection(input.selectionStart, input.value)
  const end = clampSelection(input.selectionEnd, input.value)
  if (start !== end) return replaceRange(input.value, start, end, "")
  if (start >= input.value.length) {
    return { value: input.value, selectionStart: start, selectionEnd: start }
  }
  return replaceRange(input.value, start, start + 1, "")
}

function deleteToLineEnd(input: TextInputSnapshot): TextInputEdit {
  const start = clampSelection(input.selectionStart, input.value)
  const end = clampSelection(input.selectionEnd, input.value)
  if (start !== end) return replaceRange(input.value, start, end, "")
  return replaceRange(input.value, start, lineEnd(input.value, start), "")
}

function deleteToLineStart(input: TextInputSnapshot): TextInputEdit {
  const start = clampSelection(input.selectionStart, input.value)
  const end = clampSelection(input.selectionEnd, input.value)
  if (start !== end) return replaceRange(input.value, start, end, "")
  return replaceRange(input.value, lineStart(input.value, start), start, "")
}

function deleteCurrentLine(input: TextInputSnapshot): TextInputEdit {
  const start = clampSelection(input.selectionStart, input.value)
  const end = clampSelection(input.selectionEnd, input.value)
  const rangeStart = lineStart(input.value, Math.min(start, end))
  const rangeEnd = lineEnd(input.value, Math.max(start, end))
  if (rangeEnd < input.value.length) {
    return replaceRange(input.value, rangeStart, rangeEnd + 1, "")
  }
  if (rangeStart > 0) {
    return replaceRange(input.value, rangeStart - 1, rangeEnd, "")
  }
  return replaceRange(input.value, rangeStart, rangeEnd, "")
}

function lineStart(value: string, index: number): number {
  return value.lastIndexOf("\n", Math.max(0, index - 1)) + 1
}

function lineEnd(value: string, index: number): number {
  const nextNewline = value.indexOf("\n", index)
  return nextNewline === -1 ? value.length : nextNewline
}

function replaceRange(
  value: string,
  start: number,
  end: number,
  replacement: string
): TextInputEdit {
  const rangeStart = Math.min(start, end)
  const rangeEnd = Math.max(start, end)
  const next = value.slice(0, rangeStart) + replacement + value.slice(rangeEnd)
  const cursor = rangeStart + replacement.length
  return { value: next, selectionStart: cursor, selectionEnd: cursor }
}

function clampSelection(index: number, value: string): number {
  return Math.max(0, Math.min(value.length, index))
}
