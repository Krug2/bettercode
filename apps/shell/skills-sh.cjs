/**
 * skills.sh integration — installs agent skills from the open skills
 * registry (GitHub repos) by wrapping the `npx skills` CLI (vercel-labs/
 * skills). The CLI owns the messy repo-layout discovery (skills/<name>/,
 * category nesting, .claude/skills/, plugin manifests), so we do NOT
 * re-implement fetching; we validate the source, spawn `npx skills add`,
 * and report what changed by diffing the CLI skill directories before and
 * after (robust against stdout format drift).
 *
 * Installs target BOTH CLIs globally (`-a claude-code -a codex -g`) with
 * `--copy` (Windows symlink privileges) — landing in `~/.claude/skills` and
 * `~/.codex/skills`, where the existing native discovery (ClaudeAdapter
 * fetchSkills, Codex `skills/list`, "Sync from CLI") picks them up.
 */

const fs = require("fs")
const path = require("path")
const { fetchJson } = require("./shared/fetch-json.cjs")
const {
  runCli: defaultRunCli,
  resolveCliBinary,
} = require("./shared/spawn-cli.cjs")
const {
  resolveClaudeConfigDir,
  resolveCodexHome,
} = require("./cli-plugins.cjs")

const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/
// ":" appears in registry slugs for category-nested skills (e.g.
// "react:components"); harmless as a single argv element.
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/

/**
 * Accepts `owner/repo` shorthand or a https://github.com/... URL. Rejects
 * anything that could be parsed as a CLI flag or shell metacharacter
 * (argv-injection guard) and URLs with embedded credentials.
 */
function validateSkillsShSource(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Repository is required")
  }
  const trimmed = input.trim()
  if (trimmed.startsWith("-")) {
    throw new Error(`Invalid repository: ${trimmed}`)
  }
  if (OWNER_REPO_PATTERN.test(trimmed)) return trimmed
  if (/^https:\/\/github\.com\//.test(trimmed)) {
    let parsed
    try {
      parsed = new URL(trimmed)
    } catch {
      throw new Error(`Invalid repository URL: ${trimmed}`)
    }
    if (parsed.username || parsed.password) {
      throw new Error("Repository URLs must not contain credentials")
    }
    if (/[\s"'`;&|<>$]/.test(trimmed)) {
      throw new Error(`Invalid repository URL: ${trimmed}`)
    }
    return trimmed
  }
  throw new Error(
    `Invalid repository: ${trimmed} (expected owner/repo or a github.com URL)`
  )
}

function validateSkillName(name) {
  if (name === undefined || name === null || name === "") return undefined
  if (name === "*") return "*"
  if (typeof name !== "string" || !SKILL_NAME_PATTERN.test(name.trim())) {
    throw new Error(`Invalid skill name: ${name}`)
  }
  return name.trim()
}

function listDirNames(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Snapshot of skill directory names across both CLI homes. */
function snapshotSkillDirs() {
  const snapshot = new Set()
  for (const name of listDirNames(path.join(resolveClaudeConfigDir(), "skills"))) {
    snapshot.add(`claude:${name}`)
  }
  for (const name of listDirNames(path.join(resolveCodexHome(), "skills"))) {
    snapshot.add(`codex:${name}`)
  }
  return snapshot
}

const PREVIEW_STOP_WORDS = new Set([
  "skills",
  "skill",
  "found",
  "fetching",
  "installing",
  "installed",
  "available",
  "select",
  "selected",
  "agents",
  "agent",
  "usage",
  "error",
  "warning",
  "done",
  "ok",
  "npm",
  "npx",
])

const SKILL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{1,63}$/

/**
 * Parser for `npx skills add <repo> -l` output. The CLI renders an
 * "Available Skills" block with each skill name in cyan
 * (`ESC[36m<name>ESC[39m`) on its own gutter line (`|    <name>`) followed
 * by a dim description. Primary pass extracts the cyan tokens; a plain
 * fallback (no-color environments) matches indented name-only lines.
 */
function parseSkillsShListOutput(stdoutText) {
  const text = String(stdoutText || "")
  const names = []
  const seen = new Set()
  const push = (candidate) => {
    const trimmed = candidate.trim()
    if (!SKILL_TOKEN_PATTERN.test(trimmed)) return
    if (PREVIEW_STOP_WORDS.has(trimmed.toLowerCase())) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    names.push(trimmed)
  }

  // Primary: cyan-highlighted skill names.
  for (const match of text.matchAll(/\x1b\[36m([^\x1b]+)\x1b\[39m/g)) {
    push(match[1])
  }
  if (names.length > 0) return names

  // Fallback: strip ANSI + the `|` gutter; a skill name is an indented
  // token alone on its line (descriptions contain spaces and never match).
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\s*\|/, "")
      .trim()
    if (!line) continue
    push(line)
  }
  return names
}

function requireNpx() {
  const binaryPath = resolveCliBinary("npx")
  if (!binaryPath) {
    throw new Error(
      "npx is not available — install Node.js to use skills.sh imports"
    )
  }
  return binaryPath
}

/** List the skills a repo offers without installing anything. */
async function skillsShPreview(repo, options = {}) {
  const { runCli = defaultRunCli } = options
  const source = validateSkillsShSource(repo)
  const npxPath = requireNpx()
  const result = await runCli(npxPath, ["-y", "skills", "add", source, "-l"], {
    timeoutMs: 120_000,
  })
  if (result.timedOut) throw new Error("skills.sh preview timed out")
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout || "")
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n")
    throw new Error(tail || `skills preview exited with code ${result.code}`)
  }
  return {
    skills: parseSkillsShListOutput(result.stdout),
    raw: result.stdout.trim().split("\n").slice(-40).join("\n"),
  }
}

/**
 * Install skills from a repo into both CLIs' global skill dirs.
 * @returns {Promise<{installed: Array<{target: "claude"|"codex", name: string}>}>}
 */
async function skillsShAdd(input, options = {}) {
  const { runCli = defaultRunCli } = options
  const source = validateSkillsShSource(input?.repo)
  const skill = validateSkillName(input?.skill)
  const npxPath = requireNpx()

  const before = snapshotSkillDirs()
  const args = [
    "-y",
    "skills",
    "add",
    source,
    "-g",
    "-y",
    "--copy",
    "-a",
    "claude-code",
    "-a",
    "codex",
    ...(skill ? ["-s", skill] : []),
  ]
  const result = await runCli(npxPath, args, { timeoutMs: 180_000 })
  if (result.timedOut) throw new Error("skills.sh install timed out")
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout || "")
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n")
    throw new Error(tail || `skills install exited with code ${result.code}`)
  }

  const after = snapshotSkillDirs()
  const installed = []
  for (const entry of after) {
    if (before.has(entry)) continue
    const [target, ...rest] = entry.split(":")
    installed.push({ target, name: rest.join(":") })
  }
  return { installed }
}

// ── skills.sh registry search API ──────────────────────────────────────────
// The registry exposes exactly one read endpoint (verified against the
// skills CLI v1.5.15 source): GET https://skills.sh/api/search?q=&limit=
// → {skills: [{id, skillId, name, source, installs}]}. Minimum query
// length is 2; there is NO "list all" endpoint, so the popular view below
// merges a handful of broad seed queries by install count.

const SKILLS_SH_API_BASE = "https://skills.sh"

function sanitizeRegistryText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim()
}

function mapRegistryEntry(raw) {
  if (!raw || typeof raw !== "object") return null
  const source = sanitizeRegistryText(raw.source)
  const skillId = sanitizeRegistryText(raw.skillId || raw.id)
  const name = sanitizeRegistryText(raw.name) || skillId
  if (!source || !skillId || !OWNER_REPO_PATTERN.test(source)) return null
  if (!SKILL_NAME_PATTERN.test(skillId)) return null
  return {
    id: `${source}/${skillId}`,
    skillId,
    name,
    source,
    installs: typeof raw.installs === "number" ? raw.installs : 0,
  }
}

async function fetchSearchApi(query, limit) {
  const params = new URLSearchParams({
    q: String(query),
    limit: String(limit),
  })
  const payload = await fetchJson(
    `${SKILLS_SH_API_BASE}/api/search?${params.toString()}`,
    {},
    { timeoutMs: 10_000, maxBytes: 1024 * 1024 }
  )
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.skills)) {
    throw new Error("Invalid skills.sh search response")
  }
  return payload.skills.map(mapRegistryEntry).filter(Boolean).slice(0, limit)
}

/** Live search across the whole skills.sh registry (fuzzy, min 2 chars). */
async function skillsShSearch(query, options = {}) {
  const { limit = 50 } = options
  const trimmed = String(query ?? "").trim()
  if (trimmed.length < 2) return { skills: [] }
  const skills = await fetchSearchApi(trimmed, Math.min(Math.max(limit, 1), 50))
  skills.sort((a, b) => (b.installs || 0) - (a.installs || 0))
  return { skills }
}

const POPULAR_SEED_QUERIES = [
  "skills",
  "react",
  "design",
  "next",
  "python",
  "testing",
  "security",
  "seo",
  "pdf",
  "docs",
  "git",
  "css",
]
const POPULAR_CACHE_TTL_MS = 60 * 60_000
let popularCache = null

/**
 * "Popular" registry view: the registry has no leaderboard endpoint, so we
 * merge several broad seed searches, dedupe by id, and rank by installs.
 * Cached for an hour; individual seed failures are tolerated.
 */
async function skillsShPopular(options = {}) {
  const { force = false, limit = 60 } = options
  if (
    !force &&
    popularCache &&
    Date.now() - popularCache.at < POPULAR_CACHE_TTL_MS
  ) {
    return { skills: popularCache.skills.slice(0, limit) }
  }
  const results = await Promise.allSettled(
    POPULAR_SEED_QUERIES.map((seed) => fetchSearchApi(seed, 20))
  )
  const byId = new Map()
  for (const result of results) {
    if (result.status !== "fulfilled") continue
    for (const skill of result.value) {
      const existing = byId.get(skill.id)
      if (!existing || (skill.installs || 0) > (existing.installs || 0)) {
        byId.set(skill.id, skill)
      }
    }
  }
  const skills = [...byId.values()].sort(
    (a, b) => (b.installs || 0) - (a.installs || 0)
  )
  if (skills.length > 0) {
    popularCache = { at: Date.now(), skills }
  }
  return { skills: skills.slice(0, limit) }
}

module.exports = {
  skillsShPreview,
  skillsShAdd,
  skillsShSearch,
  skillsShPopular,
  // pure helpers (unit-tested)
  validateSkillsShSource,
  validateSkillName,
  parseSkillsShListOutput,
  snapshotSkillDirs,
  mapRegistryEntry,
}
