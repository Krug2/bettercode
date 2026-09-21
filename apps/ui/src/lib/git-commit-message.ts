import { generateCommitMessage, gitDiff, gitDiffStaged, gitStatus, readFile } from "@/services/backend"
import { resolveWorkspaceFilePath } from "@/lib/editor-path"

/** Generate for exactly the scope that smart commit will commit, without staging anything. */
export async function generateWorkspaceCommitMessage(cwd: string): Promise<string> {
  const status = await gitStatus(cwd)
  const staged = status.staged.length > 0
  const files = staged ? status.staged : [...new Set([...status.modified, ...status.untracked])]
  if (!files.length) throw new Error("There are no changes to summarize.")
  const patch = await (staged ? gitDiffStaged(cwd) : gitDiff(cwd))
  const sections = patch.diff_text.split(/(?=^diff --git )/m).filter(Boolean)
  // Stay within the API's 1 MiB input limit, retaining evidence from later files.
  const perFile = Math.max(0, Math.floor(800_000 / Math.max(1, sections.length)) - 20)
  const excerpts = sections.map(section => section.length > perFile ? section.slice(0, perFile) + "\n[excerpt truncated]" : section)
  if (patch.truncated) excerpts.push("[Git diff was truncated; some file contents are unavailable.]")

  if (!staged) {
    // New files do not appear in `git diff`. Read a bounded sample without changing the index.
    const newFiles = status.untracked.slice(0, 16)
    for (let start = 0; start < newFiles.length; start += 4) {
      const batch = await Promise.all(newFiles.slice(start, start + 4).map(async file => {
        try {
          const { content } = await readFile(resolveWorkspaceFilePath(cwd, file))
          const text = content.includes("\0") ? "[Binary file; contents unavailable]" : content.slice(0, 4_000) + (content.length > 4_000 ? "\n[excerpt truncated]" : "")
          return `diff --git a/${file} b/${file}\nNew untracked file (content excerpt):\n${text}`
        } catch {
          return `diff --git a/${file} b/${file}\n[New file; contents unavailable]`
        }
      }))
      excerpts.push(...batch)
    }
    if (status.untracked.length > newFiles.length) excerpts.push("[Additional untracked files are listed in the summary; contents unavailable.]")
  }

  const generated = await generateCommitMessage({
    cwd,
    branch: status.branch,
    stagedSummary: `${staged ? "Staged changes only" : "Working tree changes (nothing staged)"}\n` + files.map(file => `${!staged && status.untracked.includes(file) ? "New" : "Changed"}: ${file}`).join("\n").slice(0, 200_000),
    stagedPatch: excerpts.join("\n"),
  })
  if (!generated.subject?.trim() || !generated.body?.trim()) {
    throw new Error("No complete commit summary was generated. Check your text-generation provider and try again. Your existing message has been kept.")
  }
  return `${generated.subject.trim()}\n\n${generated.body.trim()}`
}
