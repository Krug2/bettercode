export interface CodebaseOverviewEntry {
  path: string
  name: string
  is_dir: boolean
}

export interface CodebaseLanguageStat {
  label: string
  count: number
  percent: number
}

export interface CodebaseFolderStat {
  name: string
  path: string
  count: number
}

export interface CodebaseKeyFile {
  path: string
  name: string
  reason: string
}

export interface CodebaseFrameworkHint {
  label: string
  detail: string
}

export interface CodebaseOverview {
  totalFiles: number
  totalFolders: number
  languages: CodebaseLanguageStat[]
  topFolders: CodebaseFolderStat[]
  keyFiles: CodebaseKeyFile[]
  frameworkHints: CodebaseFrameworkHint[]
}

const extensionLabels: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  css: "CSS",
  scss: "CSS",
  json: "JSON",
  md: "Markdown",
  mjs: "JavaScript",
  cjs: "JavaScript",
  html: "HTML",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  vue: "Vue",
  svelte: "Svelte",
}

const importantFiles: Array<{
  matcher: (path: string) => boolean
  reason: string
}> = [
  { matcher: (path) => path === "package.json", reason: "Package manifest" },
  { matcher: (path) => path === "README.md", reason: "Project notes" },
  { matcher: (path) => path === "tsconfig.json", reason: "TypeScript config" },
  { matcher: (path) => path === "vite.config.ts", reason: "Vite entry" },
  { matcher: (path) => path === "next.config.js", reason: "Next.js config" },
  { matcher: (path) => path === "next.config.mjs", reason: "Next.js config" },
  { matcher: (path) => path === "tailwind.config.ts", reason: "Theme config" },
  { matcher: (path) => path.endsWith("/App.tsx"), reason: "App shell" },
  { matcher: (path) => path.endsWith("/main.tsx"), reason: "Renderer entry" },
  { matcher: (path) => path.endsWith("/index.css"), reason: "Global styles" },
]

export function buildCodebaseOverview(
  entries: readonly CodebaseOverviewEntry[]
): CodebaseOverview {
  const files = entries.filter((entry) => !entry.is_dir)
  const folders = entries.filter((entry) => entry.is_dir)
  return {
    totalFiles: files.length,
    totalFolders: folders.length,
    languages: topLanguageStats(files),
    topFolders: topFolderStats(files),
    keyFiles: keyFiles(files),
    frameworkHints: frameworkHints(files),
  }
}

function topLanguageStats(
  files: readonly CodebaseOverviewEntry[]
): CodebaseLanguageStat[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    const label = languageLabel(file.path)
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const total = Array.from(counts.values()).reduce(
    (sum, count) => sum + count,
    0
  )
  if (total === 0) return []
  return Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)
}

function topFolderStats(
  files: readonly CodebaseOverviewEntry[]
): CodebaseFolderStat[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    const first = file.path.split("/").filter(Boolean)[0]
    const name = first || "(root)"
    if (name === "node_modules" || name === ".git") continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      path: name === "(root)" ? "" : name,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8)
}

function keyFiles(files: readonly CodebaseOverviewEntry[]): CodebaseKeyFile[] {
  const seen = new Set<string>()
  const result: CodebaseKeyFile[] = []
  for (const important of importantFiles) {
    const file = files.find((item) => important.matcher(item.path))
    if (!file || seen.has(file.path)) continue
    seen.add(file.path)
    result.push({
      path: file.path,
      name: file.name,
      reason: important.reason,
    })
  }
  return result.slice(0, 7)
}

function frameworkHints(
  files: readonly CodebaseOverviewEntry[]
): CodebaseFrameworkHint[] {
  const paths = new Set(files.map((file) => file.path))
  const hints: CodebaseFrameworkHint[] = []
  if (paths.has("package.json")) {
    hints.push({ label: "Node workspace", detail: "package.json found" })
  }
  if (paths.has("vite.config.ts") || paths.has("vite.config.js")) {
    hints.push({ label: "Vite", detail: "Vite config present" })
  }
  if (paths.has("next.config.js") || paths.has("next.config.mjs")) {
    hints.push({ label: "Next.js", detail: "Next config present" })
  }
  if (
    paths.has("apps/shell/main.cjs") ||
    paths.has("electron-builder.json") ||
    paths.has("electron.vite.config.ts")
  ) {
    hints.push({ label: "Electron", detail: "desktop shell detected" })
  }
  if (paths.has("tailwind.config.ts") || paths.has("apps/ui/src/index.css")) {
    hints.push({ label: "Tailwind", detail: "utility styling detected" })
  }
  return hints.slice(0, 5)
}

function languageLabel(path: string): string | null {
  const file = path.split("/").pop() ?? path
  const dot = file.lastIndexOf(".")
  if (dot < 0 || dot === file.length - 1) return null
  return extensionLabels[file.slice(dot + 1).toLowerCase()] ?? "Other"
}
