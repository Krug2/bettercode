// ---------------------------------------------------------------------------
// Task Classification System – 27-category routing for user queries
// Pure functions, no external dependencies
// ---------------------------------------------------------------------------

export type TaskCategory =
  | "ui-ux" | "css-styling" | "theming"
  | "refactoring" | "code-cleanup"
  | "test-writing" | "test-infrastructure"
  | "documentation" | "comments"
  | "new-feature" | "feature-enhancement"
  | "bug-investigation" | "bug-fix"
  | "code-review" | "security-review"
  | "performance" | "optimization"
  | "ci-cd" | "deployment"
  | "infrastructure" | "networking"
  | "build-setup" | "linting"
  | "scripting" | "automation"
  | "charts-visualization"
  | "database" | "api"
  | "general"

export type TaskComplexity = "simple" | "moderate" | "complex"

export interface ClassificationResult {
  category: TaskCategory
  complexity: TaskComplexity
  suggestedMode: "agent" | "chat" | "plan"
  suggestedModel: "fast" | "balanced" | "flagship" | "reasoning"
  confidence: number
}

// ---------------------------------------------------------------------------
// Keyword map – each category has primary (high-weight) and secondary
// (lower-weight) keyword lists.
// ---------------------------------------------------------------------------

interface KeywordEntry {
  primary: string[]
  secondary: string[]
}

const KEYWORD_MAP: Record<TaskCategory, KeywordEntry> = {
  "ui-ux": {
    primary: ["ui", "ux", "user interface", "user experience", "layout", "responsive", "accessibility", "a11y", "aria"],
    secondary: ["component", "modal", "dialog", "tooltip", "sidebar", "navbar", "menu", "dropdown", "popover", "drawer"],
  },
  "css-styling": {
    primary: ["css", "scss", "sass", "style", "stylesheet", "tailwind", "className", "classname"],
    secondary: ["margin", "padding", "flexbox", "grid", "border", "shadow", "font", "color", "opacity", "transition", "animation"],
  },
  theming: {
    primary: ["theme", "dark mode", "light mode", "color scheme", "color palette"],
    secondary: ["brand", "accent", "primary color", "secondary color", "tokens", "css variable", "css variables"],
  },
  refactoring: {
    primary: ["refactor", "restructure", "reorganize", "extract", "decouple"],
    secondary: ["split", "merge", "move", "rename", "simplify", "modularize", "abstract"],
  },
  "code-cleanup": {
    primary: ["cleanup", "clean up", "dead code", "unused", "remove unused"],
    secondary: ["tidy", "format", "prettier", "organize imports", "lint fix"],
  },
  "test-writing": {
    primary: ["test", "unit test", "integration test", "e2e", "spec", "coverage"],
    secondary: ["jest", "vitest", "playwright", "cypress", "testing-library", "assert", "expect", "mock", "stub"],
  },
  "test-infrastructure": {
    primary: ["test setup", "test config", "test runner", "test pipeline", "test infrastructure"],
    secondary: ["fixtures", "test util", "test helper", "snapshot", "test environment"],
  },
  documentation: {
    primary: ["docs", "documentation", "readme", "jsdoc", "tsdoc", "wiki", "guide"],
    secondary: ["explain", "document", "write docs", "api docs", "changelog"],
  },
  comments: {
    primary: ["comment", "add comment", "code comment", "annotate", "todo comment"],
    secondary: ["todo", "fixme", "note", "describe"],
  },
  "new-feature": {
    primary: ["new feature", "implement", "create", "build", "add new"],
    secondary: ["from scratch", "introduce", "scaffold", "bootstrap", "new component", "new page"],
  },
  "feature-enhancement": {
    primary: ["enhance", "improve", "upgrade", "extend", "add to", "update feature"],
    secondary: ["better", "more", "also", "additionally", "support for"],
  },
  "bug-investigation": {
    primary: ["investigate", "debug", "diagnose", "why does", "why is", "not working", "broken"],
    secondary: ["trace", "root cause", "reproduce", "unexpected", "strange", "weird"],
  },
  "bug-fix": {
    primary: ["fix", "bug", "patch", "resolve", "hotfix", "regression"],
    secondary: ["error", "crash", "issue", "wrong", "incorrect", "fails", "failure", "exception"],
  },
  "code-review": {
    primary: ["review", "code review", "pr review", "feedback", "critique"],
    secondary: ["look at", "check", "evaluate", "assess", "audit code"],
  },
  "security-review": {
    primary: ["security", "vulnerability", "xss", "csrf", "injection", "auth"],
    secondary: ["sanitize", "escape", "encrypt", "token", "permission", "cors", "csp"],
  },
  performance: {
    primary: ["performance", "slow", "fast", "speed", "latency", "render time"],
    secondary: ["lazy", "memo", "cache", "bundle size", "lighthouse", "profiler", "bottleneck"],
  },
  optimization: {
    primary: ["optimize", "optimization", "efficient", "reduce", "minimize"],
    secondary: ["tree shake", "code split", "chunk", "compress", "minify", "debounce", "throttle"],
  },
  "ci-cd": {
    primary: ["ci", "cd", "ci/cd", "pipeline", "github actions", "workflow"],
    secondary: ["yml", "yaml", "action", "step", "job", "trigger", "artifact"],
  },
  deployment: {
    primary: ["deploy", "deployment", "release", "publish", "ship"],
    secondary: ["vercel", "netlify", "docker", "kubernetes", "k8s", "staging", "production", "rollback"],
  },
  infrastructure: {
    primary: ["infrastructure", "infra", "server", "cloud", "aws", "gcp", "azure"],
    secondary: ["terraform", "pulumi", "iam", "vpc", "bucket", "lambda", "ec2"],
  },
  networking: {
    primary: ["network", "dns", "ssl", "tls", "http", "https", "websocket", "proxy"],
    secondary: ["cors", "header", "request", "response", "endpoint", "socket", "port"],
  },
  "build-setup": {
    primary: ["build", "vite", "webpack", "esbuild", "rollup", "bundler", "tsconfig"],
    secondary: ["config", "plugin", "alias", "resolve", "loader", "transpile"],
  },
  linting: {
    primary: ["lint", "eslint", "biome", "prettier", "format"],
    secondary: ["rule", "ignore", "config", "autofix", "warning", "error"],
  },
  scripting: {
    primary: ["script", "bash", "shell", "cli", "command line"],
    secondary: ["npm script", "node script", "utility", "helper", "tool"],
  },
  automation: {
    primary: ["automate", "automation", "cron", "scheduled", "bot"],
    secondary: ["workflow", "hook", "pre-commit", "post-build", "watch"],
  },
  "charts-visualization": {
    primary: ["chart", "graph", "visualization", "dashboard", "plot"],
    secondary: ["recharts", "d3", "bar chart", "line chart", "pie chart", "legend", "axis", "data viz"],
  },
  database: {
    primary: ["database", "db", "sql", "nosql", "migration", "schema", "prisma", "drizzle"],
    secondary: ["query", "table", "column", "index", "relation", "seed", "orm"],
  },
  api: {
    primary: ["api", "rest", "graphql", "endpoint", "route handler", "fetch", "trpc"],
    secondary: ["get", "post", "put", "delete", "middleware", "response", "status code"],
  },
  general: {
    primary: [],
    secondary: [],
  },
}

// ---------------------------------------------------------------------------
// Complexity signals
// ---------------------------------------------------------------------------

const COMPLEXITY_ESCALATORS = [
  "complex", "complicated", "large", "big", "multi-file", "multifile",
  "entire", "whole", "all files", "every file", "across the",
  "refactor everything", "rewrite", "overhaul", "redesign",
  "architecture", "migrate", "migration",
]

const COMPLEXITY_REDUCERS = [
  "simple", "small", "quick", "tiny", "just", "only", "one file",
  "single", "minor", "trivial", "easy",
]

// ---------------------------------------------------------------------------
// classifyTask
// ---------------------------------------------------------------------------

export function classifyTask(userMessage: string): ClassificationResult {
  const msg = userMessage.toLowerCase()
  const words = msg.split(/\s+/)
  const wordCount = words.length

  // --- Score every category ---
  const scores: Record<TaskCategory, number> = {} as Record<TaskCategory, number>
  let bestCategory: TaskCategory = "general"
  let bestScore = 0

  for (const [cat, entry] of Object.entries(KEYWORD_MAP) as [TaskCategory, KeywordEntry][]) {
    let score = 0
    for (const kw of entry.primary) {
      if (msg.includes(kw)) score += 3
    }
    for (const kw of entry.secondary) {
      if (msg.includes(kw)) score += 1
    }
    scores[cat] = score
    if (score > bestScore) {
      bestScore = score
      bestCategory = cat
    }
  }

  // --- Determine confidence ---
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)
  const confidence = totalScore > 0
    ? Math.min(Math.round((bestScore / totalScore) * 100) / 100, 1)
    : 0.1

  // --- Determine complexity ---
  let complexitySignal = 0

  // Message length heuristic
  if (wordCount > 80) complexitySignal += 2
  else if (wordCount > 40) complexitySignal += 1

  // File references
  const fileRefs = (msg.match(/\b[\w\-/]+\.\w{1,5}\b/g) || []).length
  if (fileRefs > 3) complexitySignal += 2
  else if (fileRefs > 1) complexitySignal += 1

  // Explicit complexity keywords
  for (const kw of COMPLEXITY_ESCALATORS) {
    if (msg.includes(kw)) { complexitySignal += 1; break }
  }
  for (const kw of COMPLEXITY_REDUCERS) {
    if (msg.includes(kw)) { complexitySignal -= 1; break }
  }

  // Multiple categories scored high → likely complex
  const highScoring = Object.values(scores).filter(s => s >= 2).length
  if (highScoring >= 3) complexitySignal += 1

  let complexity: TaskComplexity
  if (complexitySignal >= 3) complexity = "complex"
  else if (complexitySignal >= 1) complexity = "moderate"
  else complexity = "simple"

  // --- Map to mode & model ---
  const suggestedMode = complexity === "complex"
    ? "plan"
    : complexity === "moderate"
      ? "agent"
      : "chat"

  const suggestedModel = complexity === "complex"
    ? "flagship"
    : complexity === "moderate"
      ? "balanced"
      : "fast"

  // Override: reasoning model for investigation/debug tasks regardless of length
  const reasoning = bestCategory === "bug-investigation"
    || bestCategory === "performance"
    || bestCategory === "security-review"
  const finalModel = reasoning && complexity !== "simple" ? "reasoning" : suggestedModel

  return {
    category: bestCategory,
    complexity,
    suggestedMode,
    suggestedModel: finalModel,
    confidence,
  }
}

// ---------------------------------------------------------------------------
// getCategoryIcon – returns a lucide-react icon name
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<TaskCategory, string> = {
  "ui-ux": "Layout",
  "css-styling": "Paintbrush",
  theming: "Palette",
  refactoring: "RefreshCcw",
  "code-cleanup": "Trash2",
  "test-writing": "FlaskConical",
  "test-infrastructure": "TestTube2",
  documentation: "FileText",
  comments: "MessageSquare",
  "new-feature": "Plus",
  "feature-enhancement": "Sparkles",
  "bug-investigation": "Search",
  "bug-fix": "Bug",
  "code-review": "Eye",
  "security-review": "ShieldCheck",
  performance: "Gauge",
  optimization: "Zap",
  "ci-cd": "GitBranch",
  deployment: "Rocket",
  infrastructure: "Server",
  networking: "Globe",
  "build-setup": "Hammer",
  linting: "CheckCircle",
  scripting: "Terminal",
  automation: "Bot",
  "charts-visualization": "BarChart3",
  database: "Database",
  api: "Cable",
  general: "Code",
}

export function getCategoryIcon(category: TaskCategory): string {
  return CATEGORY_ICONS[category] ?? "Code"
}

// ---------------------------------------------------------------------------
// getCategoryLabel – human-readable display name
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  "ui-ux": "UI / UX",
  "css-styling": "CSS & Styling",
  theming: "Theming",
  refactoring: "Refactoring",
  "code-cleanup": "Code Cleanup",
  "test-writing": "Test Writing",
  "test-infrastructure": "Test Infrastructure",
  documentation: "Documentation",
  comments: "Comments",
  "new-feature": "New Feature",
  "feature-enhancement": "Feature Enhancement",
  "bug-investigation": "Bug Investigation",
  "bug-fix": "Bug Fix",
  "code-review": "Code Review",
  "security-review": "Security Review",
  performance: "Performance",
  optimization: "Optimization",
  "ci-cd": "CI / CD",
  deployment: "Deployment",
  infrastructure: "Infrastructure",
  networking: "Networking",
  "build-setup": "Build Setup",
  linting: "Linting",
  scripting: "Scripting",
  automation: "Automation",
  "charts-visualization": "Charts & Visualization",
  database: "Database",
  api: "API",
  general: "General",
}

export function getCategoryLabel(category: TaskCategory): string {
  return CATEGORY_LABELS[category] ?? "General"
}

// ---------------------------------------------------------------------------
// getCategoryColor – tailwind color class
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  "ui-ux": "text-blue-400",
  "css-styling": "text-pink-400",
  theming: "text-violet-400",
  refactoring: "text-amber-400",
  "code-cleanup": "text-stone-400",
  "test-writing": "text-green-400",
  "test-infrastructure": "text-green-500",
  documentation: "text-slate-300",
  comments: "text-slate-400",
  "new-feature": "text-emerald-400",
  "feature-enhancement": "text-teal-400",
  "bug-investigation": "text-orange-400",
  "bug-fix": "text-red-400",
  "code-review": "text-indigo-400",
  "security-review": "text-rose-500",
  performance: "text-yellow-400",
  optimization: "text-lime-400",
  "ci-cd": "text-cyan-400",
  deployment: "text-sky-400",
  infrastructure: "text-zinc-400",
  networking: "text-blue-300",
  "build-setup": "text-orange-300",
  linting: "text-fuchsia-400",
  scripting: "text-neutral-300",
  automation: "text-purple-400",
  "charts-visualization": "text-cyan-300",
  database: "text-amber-300",
  api: "text-indigo-300",
  general: "text-gray-400",
}

export function getCategoryColor(category: TaskCategory): string {
  return CATEGORY_COLORS[category] ?? "text-gray-400"
}
