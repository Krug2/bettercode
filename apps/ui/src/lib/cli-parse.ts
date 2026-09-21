/**
 * CLI argument and .env-style text parsing helpers.
 *
 * Pure functions — used by settings panels (MCP, Hooks, Skills) to round-trip
 * user-edited args/env strings into structured data.
 */

/** Normalize a free-form string into a kebab-case slug suitable for an ID. */
export function slugifyRuntimeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Tokenize a shell-ish arg string into an array of arguments.
 * Supports `"double"` and `'single'` quoted values; everything else is split
 * on whitespace.
 */
export function parseCliArgs(input: string): string[] {
  const args: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return args
}

/** Inverse of {@link parseCliArgs}. Quotes any arg containing whitespace. */
export function stringifyCliArgs(args: string[] | undefined): string {
  return (args || [])
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ")
}

/** Parse `KEY=VALUE` lines into a plain object. Blank/commentless for now. */
export function parseEnvText(input: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key) env[key] = value
  }
  return env
}

/** Inverse of {@link parseEnvText}. */
export function stringifyEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}
