export type CodeOutlineKind =
  | "class"
  | "component"
  | "function"
  | "method"
  | "type"
  | "interface"
  | "enum"
  | "module"
  | "section"
  | "selector"
  | "key"

export interface CodeOutlineItem {
  id: string
  name: string
  kind: CodeOutlineKind
  line: number
  column: number
  depth: number
  detail?: string
}

const MAX_OUTLINE_ITEMS = 240

export function buildCodeOutline(input: {
  content: string
  language: string
  fileName?: string
}): CodeOutlineItem[] {
  const language = normalizeLanguage(input.language, input.fileName)
  const lines = input.content.split(/\r?\n/g)
  const items: CodeOutlineItem[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const raw = lines[index] ?? ""
    const parsed = parseLine(raw, lineNumber, language)
    if (!parsed) continue
    items.push(parsed)
    if (items.length >= MAX_OUTLINE_ITEMS) break
  }

  return dedupeOutline(items)
}

export function selectCurrentOutlinePath(
  outline: readonly CodeOutlineItem[],
  line: number
): CodeOutlineItem[] {
  const cursorLine = Math.max(1, Math.floor(line))
  const stack: CodeOutlineItem[] = []

  for (const entry of outline) {
    if (entry.line > cursorLine) break
    while (stack.length > 0 && entry.depth <= stack[stack.length - 1]!.depth) {
      stack.pop()
    }
    stack.push(entry)
  }

  return stack
}

function parseLine(
  raw: string,
  line: number,
  language: string
): CodeOutlineItem | null {
  const text = raw.trim()
  if (!text || isCommentOnly(text, language)) return null

  if (language === "markdown") return parseMarkdownLine(raw, line)
  if (language === "python") return parsePythonLine(raw, line)
  if (language === "go") return parseGoLine(raw, line)
  if (language === "rust") return parseRustLine(raw, line)
  if (["css", "scss", "less"].includes(language)) {
    return parseCssLine(raw, line)
  }
  if (language === "json") return parseJsonLine(raw, line)
  return parseJsLikeLine(raw, line)
}

function parseJsLikeLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  const depth = indentationDepth(raw)
  const column = raw.indexOf(text) + 1

  const classMatch = text.match(
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/
  )
  if (classMatch) {
    return item("class", classMatch[1]!, line, column, depth)
  }

  const interfaceMatch = text.match(
    /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/
  )
  if (interfaceMatch) {
    return item("interface", interfaceMatch[1]!, line, column, depth)
  }

  const typeMatch = text.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/)
  if (typeMatch) {
    return item("type", typeMatch[1]!, line, column, depth)
  }

  const enumMatch = text.match(/^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/)
  if (enumMatch) {
    return item("enum", enumMatch[1]!, line, column, depth)
  }

  const functionMatch = text.match(
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/
  )
  if (functionMatch) {
    return item(
      isComponentName(functionMatch[1]!) ? "component" : "function",
      functionMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  const arrowMatch = text.match(
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
  )
  if (arrowMatch) {
    return item(
      isComponentName(arrowMatch[1]!) ? "component" : "function",
      arrowMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  const methodMatch = text.match(
    /^(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{?$/
  )
  if (methodMatch && !isControlKeyword(methodMatch[1]!)) {
    return item(
      "method",
      methodMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  return null
}

function parsePythonLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  const depth = indentationDepth(raw)
  const column = raw.indexOf(text) + 1

  const classMatch = text.match(/^class\s+([A-Za-z_][\w]*)/)
  if (classMatch) return item("class", classMatch[1]!, line, column, depth)

  const functionMatch = text.match(/^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/)
  if (functionMatch) {
    return item(
      "function",
      functionMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  return null
}

function parseGoLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  const depth = indentationDepth(raw)
  const column = raw.indexOf(text) + 1

  const funcMatch = text.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/)
  if (funcMatch) {
    return item(
      "function",
      funcMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  const typeMatch = text.match(/^type\s+([A-Za-z_][\w]*)\s+(struct|interface)/)
  if (typeMatch) {
    return item(
      typeMatch[2] === "interface" ? "interface" : "type",
      typeMatch[1]!,
      line,
      column,
      depth
    )
  }

  return null
}

function parseRustLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  const depth = indentationDepth(raw)
  const column = raw.indexOf(text) + 1

  const functionMatch = text.match(
    /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/
  )
  if (functionMatch) {
    return item(
      "function",
      functionMatch[1]!,
      line,
      column,
      depth,
      signaturePreview(text)
    )
  }

  const typeMatch = text.match(
    /^(?:pub\s+)?(struct|enum|trait|impl)\s+([A-Za-z_][\w]*)?/
  )
  if (typeMatch) {
    const name = typeMatch[2] || typeMatch[1]!
    const kind =
      typeMatch[1] === "enum"
        ? "enum"
        : typeMatch[1] === "trait"
          ? "interface"
          : "type"
    return item(kind, name, line, column, depth)
  }

  return null
}

function parseMarkdownLine(raw: string, line: number): CodeOutlineItem | null {
  const match = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
  if (!match) return null
  return item(
    "section",
    match[2]!,
    line,
    match[1]!.length + 2,
    match[1]!.length - 1
  )
}

function parseCssLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  if (!text.endsWith("{") || text.startsWith("@keyframes")) return null
  const selector = text.replace(/\s*\{\s*$/, "").trim()
  if (!selector || selector.includes(";")) return null
  return item(
    "selector",
    selector,
    line,
    raw.indexOf(selector) + 1,
    indentationDepth(raw)
  )
}

function parseJsonLine(raw: string, line: number): CodeOutlineItem | null {
  const text = raw.trim()
  const match = text.match(/^"([^"]+)"\s*:/)
  if (!match) return null
  return item(
    "key",
    match[1]!,
    line,
    raw.indexOf(match[0]!) + 2,
    indentationDepth(raw)
  )
}

function item(
  kind: CodeOutlineKind,
  name: string,
  line: number,
  column: number,
  depth: number,
  detail?: string
): CodeOutlineItem {
  const cleanName = name.trim()
  return {
    id: `${line}:${column}:${kind}:${cleanName}`,
    name: cleanName,
    kind,
    line,
    column,
    depth: Math.max(0, Math.min(depth, 6)),
    ...(detail ? { detail } : {}),
  }
}

function normalizeLanguage(language: string, fileName?: string): string {
  const value = language.trim().toLowerCase()
  if (value && value !== "plaintext") return value
  const ext = fileName?.split(".").pop()?.toLowerCase()
  if (ext === "ts" || ext === "tsx") return "typescript"
  if (ext === "js" || ext === "jsx" || ext === "mjs") return "javascript"
  if (ext === "py") return "python"
  if (ext === "md" || ext === "mdx") return "markdown"
  return value || "plaintext"
}

function indentationDepth(raw: string): number {
  const indent = raw.match(/^\s*/)?.[0] ?? ""
  const spaces = indent.replace(/\t/g, "  ").length
  return Math.floor(spaces / 2)
}

function isCommentOnly(text: string, language: string): boolean {
  if (language === "python") return text.startsWith("#")
  if (language === "markdown") return false
  return text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name)
}

function isControlKeyword(name: string): boolean {
  return ["if", "for", "while", "switch", "catch", "function"].includes(name)
}

function signaturePreview(text: string): string {
  return text.replace(/\s*\{?\s*$/, "").slice(0, 120)
}

function dedupeOutline(items: CodeOutlineItem[]): CodeOutlineItem[] {
  const seen = new Set<string>()
  return items.filter((entry) => {
    const key = `${entry.line}:${entry.kind}:${entry.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
