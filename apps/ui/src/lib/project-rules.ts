import {
  listProjectInstructions,
  readFile,
} from "@/services/backend/workspaceApi"

/**
 * Project-local rule files that BetterC0de reads and injects into the chat's
 * system prompt on every send. Mirrors the convention adopted by other AI
 * coding tools (Claude Code, Copilot, Cursor, Aider, Zed, Codex, Cline) so
 * opening any repo that already has one of these files gives instant
 * project-aware context — without the user having to copy-paste into the
 * global rules.
 */
const CANDIDATE_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "CONTEXT.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const

const MAX_BYTES_PER_FILE = 8000
const MAX_BYTES_TOTAL = 32000

function joinProjectPath(base: string, sub: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/"
  const trimmed =
    base.endsWith("/") || base.endsWith("\\") ? base.slice(0, -1) : base
  return `${trimmed}${sep}${sub.replace(/[\\/]/g, sep)}`
}

interface ProjectRuleFile {
  name: string
  content: string
}

/**
 * Reads every known project-rule file from `projectPath` in parallel.
 * Missing files and unreadable files are silently skipped so a hostile
 * repo can't crash the chat pipeline.
 *
 * Returns `null` if no project path is active or no rule file was found —
 * callers should treat that as "no project rules injected".
 */
export async function getProjectRules(
  projectPath: string | null | undefined
): Promise<string | null> {
  if (!projectPath || typeof projectPath !== "string") return null

  const [candidateResults, betterC0deInstructions] = await Promise.all([
    Promise.all(
      CANDIDATE_FILES.map(async (name): Promise<ProjectRuleFile | null> => {
        try {
          const full = joinProjectPath(projectPath, name)
          // `silent404`: most projects have at most one of these candidates,
          // so the other 3 readFile() calls 404 every send. Without the flag
          // each one paints a red error in DevTools.
          const res = await readFile(full, { silent404: true })
          const content = res?.content
          if (!content || !content.trim()) return null
          const clipped =
            content.length > MAX_BYTES_PER_FILE
              ? content.slice(0, MAX_BYTES_PER_FILE) + "\n\n...[truncated]"
              : content
          return { name, content: clipped.trim() }
        } catch {
          return null
        }
      })
    ),
    listProjectInstructions(projectPath).catch(() => []),
  ])

  const results = [
    ...candidateResults,
    ...betterC0deInstructions.map((item): ProjectRuleFile => {
      const content =
        item.content.length > MAX_BYTES_PER_FILE
          ? item.content.slice(0, MAX_BYTES_PER_FILE) + "\n\n...[truncated]"
          : item.content
      return {
        name: `BetterC0de compatibility instructions: ${item.sourcePath}`,
        content: content.trim(),
      }
    }),
  ]

  // De-dupe identical file contents (users who symlink CLAUDE.md → AGENTS.md
  // would otherwise double-inject the same text).
  const seen = new Set<string>()
  const unique: ProjectRuleFile[] = []
  for (const r of results) {
    if (!r) continue
    if (seen.has(r.content)) continue
    seen.add(r.content)
    unique.push(r)
  }
  if (unique.length === 0) return null

  const sections = unique.map((r) => `### ${r.name}\n\n${r.content}`)
  let combined = sections.join("\n\n---\n\n")
  if (combined.length > MAX_BYTES_TOTAL) {
    combined =
      combined.slice(0, MAX_BYTES_TOTAL) +
      "\n\n…[project rules truncated to fit context budget]"
  }
  return combined
}
