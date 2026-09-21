export const FILE_CHANGE_PREVIEW_COUNT = 5
export const FILE_CHANGE_PAGE_SIZE = 50

/** Presentation only: checkpoints and the recorded file list stay complete. */
export function groupFileChanges<T extends { path: string; additions: number; deletions: number }>(
  files: readonly T[],
  workspaceRoot?: string | null,
) {
  const projectFiles: T[] = []
  const generatedFiles: T[] = []
  for (const file of files) {
    const relative = relativeDisplayPath(file.path, workspaceRoot)
    const segments = relative.toLowerCase().split("/")
    const generated = segments.some(segment =>
      /^\.(?:tmp|temp)(?:[-_.]|$)/.test(segment) ||
      /^(?:node_modules|\.next|\.nuxt|\.cache|\.vite|\.turbo|\.playwright|\.puppeteer|playwright-report|test-results)$/.test(segment)
    ) || /(?:^|\/)(?:browser-profile|chrome-profile|chromium-profile|playwright-profile|user-data-dir)(?:[-_][^/]*)?\//i.test(relative) ||
      /(?:^|\/)profiles?\/(?:default|profile \d+|crashpad)\//i.test(relative)
    if (generated) generatedFiles.push(file)
    else projectFiles.push(file)
  }
  // Keep source/config edits ahead of opaque runtime files in older snapshots.
  projectFiles.sort((a, b) => priority(a.path) - priority(b.path))
  return {
    projectFiles,
    generatedFiles,
    additions: projectFiles.reduce((sum, file) => sum + file.additions, 0),
    deletions: projectFiles.reduce((sum, file) => sum + file.deletions, 0),
  }
}

function relativeDisplayPath(filePath: string, workspaceRoot?: string | null): string {
  const normalized = filePath.replace(/\\/g, "/")
  const root = workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!root) return normalized
  const prefix = `${root}/`
  const windows = /^[a-z]:\//i.test(root) || root.startsWith("//")
  if ((windows ? normalized.toLowerCase() : normalized).startsWith(windows ? prefix.toLowerCase() : prefix)) {
    return normalized.slice(prefix.length)
  }
  return normalized
}

function priority(filePath: string): number {
  return /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|scss|sass|less|jsonc?|ya?ml|toml|mdx?|py|rs|go|java|kt|swift|c|cpp|h|cs|php|rb|sql|sh|ps1)$|(?:^|[/\\])(?:\.gitignore|Dockerfile|Makefile)$/i.test(filePath) ? 0 : 1
}
