import { browserElementKey, type BrowserElementReference } from "@betterc0de/schema"

export interface BrowserMentionRange { start: number; end: number; element: BrowserElementReference }

export function browserMentionRanges(text: string, elements: readonly BrowserElementReference[]): BrowserMentionRange[] {
  const names = new Map(elements.filter(element => element.mentionName).map(element => [element.mentionName, element]))
  return [...text.matchAll(/@[A-Z][A-Za-z0-9]{0,31}/g)].flatMap(match => {
    const element = names.get(match[0].slice(1))
    const start = match.index
    const end = start + match[0].length
    const isFileExtension = text[end] === "." && /\w/.test(text[end + 1] ?? "")
    return element && !/[\w@]/.test(text[start - 1] ?? "") && !/[\w/\\-]/.test(text[end] ?? "") && !isFileExtension ? [{ start, end, element }] : []
  })
}

export function assignBrowserMentionNames(elements: readonly BrowserElementReference[], draft: string): BrowserElementReference[] {
  const reserved = new Set([...draft.matchAll(/@([A-Za-z0-9]+)/g)].map(match => match[1]))
  for (const element of elements) if (element.mentionName) reserved.add(element.mentionName)
  return elements.map(element => {
    if (element.mentionName) return element
    const tag = element.tagName.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)
    const base = tag === "img" ? "Image" : /^[a-z]/i.test(tag) ? tag[0].toUpperCase() + tag.slice(1) : "Component"
    let name = base
    for (let suffix = 2; reserved.has(name); suffix++) name = `${base}${suffix}`
    reserved.add(name)
    return { ...element, mentionName: name }
  })
}

export function removeBrowserMentionAtCursor(text: string, start: number, end: number, key: "Backspace" | "Delete", elements: readonly BrowserElementReference[]): { value: string; cursor: number } | null {
  const ranges = browserMentionRanges(text, elements).filter(range => start !== end
    ? range.start < end && range.end > start
    : key === "Backspace" ? start > range.start && start <= range.end : start >= range.start && start < range.end)
  if (!ranges.length) return null
  const from = Math.min(start, ...ranges.map(range => range.start))
  const to = Math.max(end, ...ranges.map(range => range.end))
  return { value: text.slice(0, from) + text.slice(to), cursor: from }
}

export function removeBrowserMentionText(text: string, element: BrowserElementReference): string {
  for (const range of browserMentionRanges(text, [element]).reverse()) text = text.slice(0, range.start) + text.slice(range.end)
  return text
}

export function removedBrowserMentions(before: string, after: string, elements: readonly BrowserElementReference[]): BrowserElementReference[] {
  const remaining = new Set(browserMentionRanges(after, elements).map(range => browserElementKey(range.element)))
  return browserMentionRanges(before, elements).map(range => range.element).filter(element => !remaining.has(browserElementKey(element)))
}

/** Prevent component mentions from being interpreted as file/skill references. */
export function maskBrowserMentions(text: string, elements: readonly BrowserElementReference[]): string {
  for (const range of browserMentionRanges(text, elements).reverse()) text = text.slice(0, range.start) + " ".repeat(range.end - range.start) + text.slice(range.end)
  return text
}
