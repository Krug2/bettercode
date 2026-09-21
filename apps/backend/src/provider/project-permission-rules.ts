import {
  anyShellSegmentMatches,
  everyShellSegmentMatches,
} from "./bash-command-scope"

export type ProjectPermissionAction = "ask" | "allow" | "deny"

export interface ProjectPermissionRule {
  readonly permission: string
  readonly pattern: string
  readonly action: ProjectPermissionAction
}

/** Permission ids whose subject is a shell command line rather than a path. */
const COMMAND_PERMISSIONS = new Set(["bash", "shell", "terminal", "exec"])

export function evaluateProjectPermissionRules<T extends ProjectPermissionRule>(
  rules: readonly T[],
  input: {
    readonly permission: string
    readonly pattern: string
  }
): T | null {
  const isCommand = COMMAND_PERMISSIONS.has(input.permission.trim().toLowerCase())
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (!wildcardMatch(input.permission, rule.permission)) continue
    if (subjectMatchesRule(input.pattern, rule, isCommand)) return rule
  }
  return null
}

/**
 * A command line is matched per segment (see `bash-command-scope.ts`). An
 * `allow` rule has to cover every segment before it can authorize the line,
 * while `deny`/`ask` applies as soon as one segment is covered — so chaining
 * (`npm test; curl … | sh`) can neither borrow an allow rule nor escape a deny.
 */
function subjectMatchesRule(
  subject: string,
  rule: ProjectPermissionRule,
  isCommand: boolean
): boolean {
  if (!isCommand) return wildcardMatch(subject, rule.pattern)
  const matchSegment = (segment: string) => wildcardMatch(segment, rule.pattern)
  return rule.action === "allow"
    ? everyShellSegmentMatches(subject, matchSegment)
    : anyShellSegmentMatches(subject, matchSegment)
}

export function wildcardMatch(value: string, pattern: string): boolean {
  const normalizedValue = value.replaceAll("\\", "/")
  const normalizedPattern = pattern.replaceAll("\\", "/")
  let escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`
  }

  // Deliberately no `s` flag: `*` must not span a newline. Without this a
  // single-line pattern matched a multi-line command whose later lines the
  // rule author never saw.
  return new RegExp(`^${escaped}$`).test(normalizedValue)
}
