import {
  isAbsoluteEditorPath,
  isEditorPathEqualOrInside,
  normalizeEditorPath,
  resolveWorkspaceFilePath,
} from "@/lib/editor-path"

const MAX_SOURCE_REFERENCE_LENGTH = 4_096
const MAX_SYMBOL_LENGTH = 512
const MAX_LOCATION_VALUE = 2_147_483_647

const COMMON_EXTENSIONLESS_FILES = new Set([
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "rakefile",
  "readme",
])

export interface SourceFileTarget {
  kind: "file"
  filePath: string
  /** One-based start line. */
  line?: number
  /** One-based start column. Requires `line`. */
  column?: number
  /** One-based inclusive end line. Requires `line`. */
  endLine?: number
  /** One-based exclusive end column. Requires `line`. */
  endColumn?: number
}

export interface SourceSymbolTarget {
  kind: "symbol"
  filePath: string
  symbol: string
  /** A resolved symbol location when the producer already knows it. */
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface SourceExternalTarget {
  kind: "external"
  url: string
}

export type SourceOpenTarget =
  | SourceFileTarget
  | SourceSymbolTarget
  | SourceExternalTarget

export type ResolvedSourceOpenTarget = SourceOpenTarget

export interface ParseSourceReferenceOptions {
  /**
   * Require an obvious path marker. Use this for inline code, where ordinary
   * identifiers should remain code instead of becoming file buttons.
   */
  requirePathSignal?: boolean
}

export interface ResolveSourceTargetOptions {
  workspacePath?: string | null
  /**
   * Explicit escape hatch for trusted callers such as a future system file
   * picker. Agent-produced references should leave this disabled.
   */
  allowOutsideWorkspace?: boolean
}

interface ParsedLocation {
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

/**
 * Parses the source-reference forms commonly emitted by coding agents:
 *
 * - `src/app.ts`
 * - `src/app.ts:12:4`
 * - `src/app.ts:12:4-18:9`
 * - `src/app.ts#L12C4-L18C9`
 * - `src/app.ts#symbol=renderApp`
 * - `file:///workspace/src/app.ts#L12`
 * - `https://example.test/docs`
 */
export function parseSourceReference(
  input: string,
  options: ParseSourceReferenceOptions = {}
): SourceOpenTarget | null {
  const value = unwrapReference(input)
  if (!value || value.length > MAX_SOURCE_REFERENCE_LENGTH) return null
  if (hasUnsafeCharacters(value)) return null

  const external = parseExternalTarget(value)
  if (external) return external

  const fileUrl = parseFileUrl(value)
  if (fileUrl) {
    if (
      options.requirePathSignal &&
      !hasPathSignal(fileUrl.filePath, fileUrl.line !== undefined)
    ) {
      return null
    }
    return fileUrl
  }

  const fragmentSplit = splitSourceFragment(value)
  const suffixSplit = parseColonLocation(fragmentSplit.filePath)
  // Refuse every URI scheme except HTTP(S) and file. An extension-bearing
  // basename followed by a numeric location (for example `app.ts:12`) is a
  // source reference, while `tel:123` and other custom schemes are not.
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    (!suffixSplit || !hasPathSignal(suffixSplit.filePath, true))
  ) {
    return null
  }
  const rawPath = suffixSplit?.filePath ?? fragmentSplit.filePath
  const filePath = decodeSourcePath(rawPath)
  if (!filePath) return null

  const location = fragmentSplit.location ?? suffixSplit?.location ?? {}
  if (
    options.requirePathSignal &&
    !hasPathSignal(filePath, location.line !== undefined)
  ) {
    return null
  }

  if (fragmentSplit.symbol) {
    return {
      kind: "symbol",
      filePath,
      symbol: fragmentSplit.symbol,
      ...location,
    }
  }
  return { kind: "file", filePath, ...location }
}

/**
 * Resolves a parsed/typed target to a safe absolute workspace file or a
 * normalized HTTP(S) URL. Relative traversal and absolute paths outside the
 * active workspace are rejected by default.
 */
export function resolveSourceTarget(
  target: SourceOpenTarget,
  options: ResolveSourceTargetOptions = {}
): ResolvedSourceOpenTarget | null {
  if (target.kind === "external") {
    return parseExternalTarget(target.url)
  }

  const location = normalizeLocation(target)
  if (!location) return null
  const filePath = normalizeSafePath(target.filePath)
  if (!filePath) return null

  const workspacePath = options.workspacePath?.trim()
  let resolvedPath: string
  if (isAbsoluteEditorPath(filePath)) {
    if (
      !options.allowOutsideWorkspace &&
      (!workspacePath ||
        !isEditorPathEqualOrInside(
          filePath,
          normalizeEditorPath(workspacePath)
        ))
    ) {
      return null
    }
    resolvedPath = filePath
  } else {
    if (!workspacePath) return null
    resolvedPath = normalizeEditorPath(
      resolveWorkspaceFilePath(workspacePath, filePath)
    )
    if (
      !isEditorPathEqualOrInside(
        resolvedPath,
        normalizeEditorPath(workspacePath)
      )
    ) {
      return null
    }
  }

  if (target.kind === "symbol") {
    const symbol = normalizeSymbol(target.symbol)
    if (!symbol) return null
    return {
      kind: "symbol",
      filePath: resolvedPath,
      symbol,
      ...location,
    }
  }
  return { kind: "file", filePath: resolvedPath, ...location }
}

function unwrapReference(input: string): string {
  let value = input.trim()
  const wrappers: ReadonlyArray<readonly [string, string]> = [
    ["`", "`"],
    ["<", ">"],
  ]
  for (const [start, end] of wrappers) {
    if (value.startsWith(start) && value.endsWith(end)) {
      value = value.slice(start.length, -end.length).trim()
      break
    }
  }
  return value
}

function parseExternalTarget(value: string): SourceExternalTarget | null {
  if (
    !value ||
    value.length > MAX_SOURCE_REFERENCE_LENGTH ||
    hasUnsafeCharacters(value)
  ) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  if (parsed.username || parsed.password) return null
  return { kind: "external", url: parsed.href }
}

function parseFileUrl(
  value: string
): SourceFileTarget | SourceSymbolTarget | null {
  if (!/^file:/i.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== "file:") return null

  let pathname: string
  try {
    pathname = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }
  const host =
    parsed.hostname && parsed.hostname.toLowerCase() !== "localhost"
      ? parsed.hostname
      : ""
  let filePath = host ? `//${host}${pathname}` : pathname
  if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1)

  const fragment = parseLocationFragment(parsed.hash.replace(/^#/, ""))
  const symbol = parseSymbolFragment(parsed.hash.replace(/^#/, ""))
  if (symbol) {
    return { kind: "symbol", filePath, symbol, ...(fragment ?? {}) }
  }
  return { kind: "file", filePath, ...(fragment ?? {}) }
}

function splitSourceFragment(value: string): {
  filePath: string
  location: ParsedLocation | null
  symbol: string | null
} {
  const hashIndex = value.lastIndexOf("#")
  if (hashIndex < 0) {
    return { filePath: value, location: null, symbol: null }
  }
  const filePath = value.slice(0, hashIndex)
  const fragment = value.slice(hashIndex + 1)
  return {
    filePath,
    location: parseLocationFragment(fragment),
    symbol: parseSymbolFragment(fragment),
  }
}

function parseLocationFragment(fragment: string): ParsedLocation | null {
  if (!fragment) return null
  const match = /^L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C(\d+))?)?$/i.exec(fragment)
  if (!match) return null
  return locationFromStrings(match[1], match[2], match[3], match[4])
}

function parseSymbolFragment(fragment: string): string | null {
  const match = /^symbol=(.+)$/i.exec(fragment)
  if (!match?.[1]) return null
  try {
    return normalizeSymbol(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

function parseColonLocation(value: string): {
  filePath: string
  location: ParsedLocation
} | null {
  const patterns = [
    /^(.*):(\d+):(\d+)-(\d+):(\d+)$/,
    /^(.*):(\d+):(\d+)-(\d+)$/,
    /^(.*):(\d+)-(\d+):(\d+)$/,
    /^(.*):(\d+)-(\d+)$/,
    /^(.*):(\d+):(\d+)$/,
    /^(.*):(\d+)$/,
  ] as const
  for (const pattern of patterns) {
    const match = pattern.exec(value)
    if (!match?.[1]) continue
    const location = locationFromStrings(
      match[2],
      pattern === patterns[2] || pattern === patterns[3] ? undefined : match[3],
      pattern === patterns[2] || pattern === patterns[3] ? match[3] : match[4],
      pattern === patterns[2] ? match[4] : match[5]
    )
    if (location) return { filePath: match[1], location }
  }
  return null
}

function locationFromStrings(
  lineValue: string | undefined,
  columnValue: string | undefined,
  endLineValue: string | undefined,
  endColumnValue: string | undefined
): ParsedLocation | null {
  const line = parseLocationInteger(lineValue)
  if (!line) return null
  const column = columnValue ? parseLocationInteger(columnValue) : 1
  if (!column) return null
  const parsedEndLine = endLineValue
    ? parseLocationInteger(endLineValue)
    : undefined
  if (parsedEndLine === null) return null
  const parsedEndColumn = endColumnValue
    ? parseLocationInteger(endColumnValue)
    : undefined
  if (parsedEndColumn === null) return null
  return {
    line,
    column,
    ...(parsedEndLine === undefined ? {} : { endLine: parsedEndLine }),
    ...(parsedEndColumn === undefined ? {} : { endColumn: parsedEndColumn }),
  }
}

function decodeSourcePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return normalizeEditorPath(decodeURIComponent(trimmed))
  } catch {
    return null
  }
}

function normalizeSafePath(value: string): string | null {
  const decoded = decodeSourcePath(value)
  if (!decoded || hasUnsafeCharacters(decoded)) return null
  const segments = decoded.split("/")
  if (segments.some((segment) => segment === "..")) return null
  const collapsed = segments.filter((segment) => segment !== ".").join("/")
  if (!collapsed || collapsed.length > MAX_SOURCE_REFERENCE_LENGTH) return null
  return collapsed
}

function normalizeLocation(
  target: SourceFileTarget | SourceSymbolTarget
): ParsedLocation | null {
  const hasAnyLocation =
    target.line !== undefined ||
    target.column !== undefined ||
    target.endLine !== undefined ||
    target.endColumn !== undefined
  if (!hasAnyLocation) return {}

  const line = normalizeLocationInteger(target.line)
  if (!line) return null
  const column =
    target.column === undefined ? 1 : normalizeLocationInteger(target.column)
  if (!column) return null

  const hasEnd = target.endLine !== undefined || target.endColumn !== undefined
  if (!hasEnd) return { line, column }
  const parsedEndLine =
    target.endLine === undefined
      ? line
      : normalizeLocationInteger(target.endLine)
  if (parsedEndLine === null) return null
  const parsedEndColumn =
    target.endColumn === undefined
      ? undefined
      : normalizeLocationInteger(target.endColumn)
  if (parsedEndColumn === null) return null
  const endLine = parsedEndLine
  const endColumn = parsedEndColumn
  if (endLine < line) return null
  if (endLine === line && endColumn !== undefined && endColumn < column) {
    return null
  }
  return { line, column, endLine, endColumn }
}

function normalizeLocationInteger(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null
  if (value < 1 || value > MAX_LOCATION_VALUE) return null
  return value
}

function parseLocationInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return normalizeLocationInteger(parsed)
}

function normalizeSymbol(value: string): string | null {
  const symbol = value.trim()
  if (!symbol || symbol.length > MAX_SYMBOL_LENGTH) return null
  if (hasUnsafeCharacters(symbol)) return null
  return symbol
}

function hasPathSignal(filePath: string, hasLocation: boolean): boolean {
  const normalized = normalizeEditorPath(filePath)
  if (
    normalized.includes("/") ||
    normalized.startsWith(".") ||
    isAbsoluteEditorPath(normalized)
  ) {
    return true
  }
  const fileName = normalized.toLowerCase()
  if (COMMON_EXTENSIONLESS_FILES.has(fileName)) return true
  if (hasLocation && COMMON_EXTENSIONLESS_FILES.has(fileName.split(":")[0]!)) {
    return true
  }
  return /\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)
}

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 31 || code === 127) return true
  }
  return false
}
