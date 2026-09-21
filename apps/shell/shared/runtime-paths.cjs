/**
 * Shared filesystem + window conveniences used by every *-ipc.cjs module.
 *
 * Extracted from the monolithic `onboarding-ipc.cjs` so MCP, skills, hooks,
 * and subagents can each live in their own file without copy-pasting the
 * `.betterc0de` vs `.betterc0de-dev` detection and the runtime paths table.
 */

const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const path = require("path")
const os = require("os")
const appConfig = require("./appConfig.cjs")

/**
 * Resolve the per-user data root. Packaged builds use `~/.betterc0de`,
 * dev builds use `~/.betterc0de-dev` so test data doesn't collide with a
 * user's real install. BETTERC0DE_HOME selects the same base used by
 * `resolveBetterC0deUserDataDir()` in `apps/shell/main.cjs`.
 */
function getBaseDir() {
  const override = (process.env.BETTERC0DE_HOME || "").trim()
  if (override) {
    if (!path.isAbsolute(override) || override.includes("\0")) {
      throw new Error("BETTERC0DE_HOME must be an absolute filesystem path")
    }
    return path.resolve(override)
  }
  const baseDirName = app.isPackaged ? ".betterc0de" : ".betterc0de-dev"
  return path.join(os.homedir(), baseDirName)
}

/** Marker file that flips after the user completes onboarding. */
function getDoneFlag() {
  return path.join(getBaseDir(), "onboarding-done")
}

/** Canonical paths table — every *-ipc.cjs reads its file/dir from here. */
function getRuntimePaths() {
  const baseDir = getBaseDir()
  return {
    baseDir,
    mcpFile: path.join(baseDir, "mcp-servers.json"),
    skillsDir: path.join(baseDir, "skills"),
    hooksFile: path.join(baseDir, "hooks.json"),
    rulesFile: path.join(baseDir, "rules.md"),
    subagentsDir: path.join(baseDir, "subagents"),
    pluginsFile: path.join(baseDir, "imported-plugins.json"),
  }
}

/** mkdir -p. Returns the directory so callers can chain. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Normalize free-form user input into a filesystem-safe id. Used by every
 * save handler (skill, subagent, mcp) so the on-disk id can't contain
 * separators, escapes, or arbitrarily long strings.
 */
function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, appConfig.SLUG_MAX_LENGTH)
}

/**
 * Pick a window to attach modal dialogs to. Prefers the currently focused
 * window; falls back to any available BrowserWindow. Returns null when
 * the app has no windows yet (shouldn't happen on IPC paths but handlers
 * defend anyway).
 */
function getFocusedWindow() {
  return (
    BrowserWindow.getFocusedWindow() ||
    BrowserWindow.getAllWindows()[0] ||
    null
  )
}

module.exports = {
  getBaseDir,
  getDoneFlag,
  getRuntimePaths,
  ensureDir,
  slugify,
  getFocusedWindow,
}
