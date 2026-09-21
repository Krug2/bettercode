#!/usr/bin/env node
/**
 * Root postinstall hook. It keeps the local better-sqlite3 binary aligned
 * with the developer's Node runtime. Packaging performs a separate Electron
 * ABI rebuild immediately before electron-builder runs.
 *
 * Set BETTERC0DE_SKIP_POSTINSTALL=1 for environments that intentionally defer
 * the native rebuild. Nested invocations are guarded against recursion.
 */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function shouldSkip(env = process.env) {
  if (env.BETTERC0DE_SKIP_POSTINSTALL === "1") return "BETTERC0DE_SKIP_POSTINSTALL=1";
  if (env.BETTERC0DE_POSTINSTALL_RAN === "1") return "recursion guard";
  return null;
}

function run(cmd, args, cwd, { spawnSyncImpl = spawnSync, env = process.env, logger = console } = {}) {
  logger.log(`[postinstall] $ ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSyncImpl(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...env, BETTERC0DE_POSTINSTALL_RAN: "1" },
  });

  if (result.error) throw result.error;
  if (!Number.isInteger(result.status)) {
    const signal = result.signal ? ` (${result.signal})` : "";
    throw new Error(`${cmd} terminated without an exit code${signal}`);
  }
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
}

function main({
  env = process.env,
  existsSync = fs.existsSync,
  spawnSyncImpl = spawnSync,
  logger = console,
  repoRoot = path.resolve(__dirname, ".."),
} = {}) {
  const skip = shouldSkip(env);
  if (skip) {
    logger.log(`[postinstall] skipping (${skip})`);
    return;
  }

  const backendDir = path.join(repoRoot, "apps", "backend");
  if (!existsSync(backendDir)) {
    logger.log("[postinstall] apps/backend/ not found; skipping");
    return;
  }

  logger.log("[postinstall] Rebuilding native modules for local Node …");
  run("npm", ["rebuild", "better-sqlite3"], repoRoot, {
    spawnSyncImpl,
    env,
    logger,
  });
  logger.log("[postinstall] done");
}

function runCli(options = {}) {
  const logger = options.logger || console;
  try {
    main(options);
    return 0;
  } catch (error) {
    logger.error("[postinstall] failed:", error && error.message ? error.message : error);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = { main, run, runCli, shouldSkip };
