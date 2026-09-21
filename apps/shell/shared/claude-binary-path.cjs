"use strict";

// Resolves the path to the Claude Code native binary shipped by
// `@anthropic-ai/claude-agent-sdk-<platform>-<arch>`. Must be passed to
// `sdk.query({ options: { pathToClaudeCodeExecutable } })` because the SDK's
// own `require.resolve` returns a path INSIDE `app.asar` in the packaged
// build — Electron's asar mapping makes it readable to `fs.statSync`, but
// `child_process.spawn` bypasses asar mapping and the OS fails ENOENT trying
// to launch a binary out of a virtual archive. Resolving against
// `process.resourcesPath/app.asar.unpacked/...` returns a real on-disk path
// that the OS can actually exec.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

// On macOS the OAuth token in Keychain is access-listed by the EXACT
// signing identity of the binary that wrote it — usually the user's
// installed `claude` CLI. The Anthropic SDK ships its own `claude`
// binary, which has a different identity and therefore can't read the
// already-stored token. Spawning the bundled binary on a machine where
// the user has logged in via `claude auth login` results in a hang at
// "Node backend ready" → `turn_started` → no output, because the
// bundled binary blocks on a Keychain prompt the renderer never sees.
//
// To fix that without forcing the user to re-login through the bundled
// binary, the resolver now prefers an installed system `claude` (which
// IS on the Keychain ACL) over the bundled SDK binary. The bundled
// binary stays as a fallback for users who never installed Claude Code
// locally — those users will see a Keychain prompt on first chat and
// can click "Always Allow".
//
// Known caveats:
//   • If the system `claude` is older than what the SDK expects, the
//     SDK protocol could mismatch. Empirically the SDK is forward- and
//     backward-compatible across a few minor versions of Claude Code,
//     so picking the user's version is the lesser evil vs. the
//     Keychain hang.
//   • `BETTERC0DE_CLAUDE_CODE_PATH` set in the env always wins — gives
//     CI / power users an explicit escape hatch.

function tryEnvOverride() {
  const override = process.env.BETTERC0DE_CLAUDE_CODE_PATH;
  if (!override) return null;
  try {
    if (fs.statSync(override).isFile()) return override;
  } catch { /* override path doesn't exist, ignore */ }
  return null;
}

function trySystemClaude() {
  const ext = process.platform === "win32" ? ".exe" : "";
  // 1. PATH lookup — works in dev where Electron inherits the user's
  //    shell PATH. In a Finder-launched packaged app the PATH is the
  //    minimal `/usr/bin:/bin:/usr/sbin:/sbin`, so this normally only
  //    catches users who installed `claude` into a system-wide dir.
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const r = spawnSync(cmd, [`claude${ext}`], { encoding: "utf8", timeout: 2000 });
    if (r.status === 0) {
      const candidate = r.stdout.trim().split(/\r?\n/)[0];
      if (candidate && fs.statSync(candidate).isFile()) return candidate;
    }
  } catch { /* `which`/`where` missing or timed out */ }

  // 2. Known macOS / Linux install locations the user's shell rc files
  //    would have on PATH — covers the Finder-launched case.
  const home = os.homedir();
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      path.join(home, ".bun", "bin", "claude"),
      path.join(home, ".npm-global", "bin", "claude"),
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      path.join(home, ".bun", "bin", "claude"),
      path.join(home, ".npm-global", "bin", "claude"),
    );
  } else if (process.platform === "win32") {
    const userProfile = process.env.USERPROFILE || home;
    const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(userProfile, "AppData", "Roaming");
    candidates.push(
      path.join(localAppData, "Programs", "Anthropic", "claude", "claude.exe"),
      path.join(appData, "npm", "claude.cmd"),
      path.join(appData, "npm", "claude.exe"),
      path.join(userProfile, ".bun", "bin", "claude.exe"),
    );
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* not present, try next */ }
  }
  return null;
}

function tryBundledSdk() {
  const ext = process.platform === "win32" ? ".exe" : "";
  const arch = process.arch;
  const platform = process.platform;

  const pkgs = [];
  if (platform === "linux") pkgs.push(`@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`);
  pkgs.push(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`);

  // Packaged: `<resourcesPath>/app.asar.unpacked/node_modules/<pkg>/claude<ext>`.
  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    for (const pkg of pkgs) {
      const candidate = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        ...pkg.split("/"),
        `claude${ext}`,
      );
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not present, try next candidate */ }
    }
  }

  // Dev: `node_modules/<pkg>/claude<ext>` via Node's resolver.
  for (const pkg of pkgs) {
    try {
      return require.resolve(`${pkg}/claude${ext}`);
    } catch { /* not installed for this platform/arch — try next */ }
  }
  return null;
}

// Resolution costs a synchronous `where`/`which` spawn (up to a 2s timeout on
// Windows) and runs on the main thread just before the backend is forked.
// It is called again on every backend restart, so the answer is memoized —
// the binary does not move while the app is running.
let cachedBinaryPath;

function resolveClaudeCodeBinaryPath() {
  if (cachedBinaryPath === undefined) {
    cachedBinaryPath = tryEnvOverride() ?? trySystemClaude() ?? tryBundledSdk();
  }
  return cachedBinaryPath;
}

/** Lets a reinstall be picked up without restarting the app. */
function clearClaudeCodeBinaryPathCache() {
  cachedBinaryPath = undefined;
}

module.exports = {
  resolveClaudeCodeBinaryPath,
  clearClaudeCodeBinaryPathCache,
};
