import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// detect.ts fixes its persistent cache path at import time; point it at a
// scratch directory before the module loads so tests never write into the
// user's real ~/.betterc0de.
const dataDir = vi.hoisted(() => {
  // No imports are available inside a hoisted block; `process` is a global.
  const tmp =
    process.env.TEMP?.trim() || process.env.TMPDIR?.trim() || "/tmp";
  const dir = `${tmp}/betterc0de-cli-data-${process.pid}-${Date.now()}`;
  process.env.BETTERC0DE_DATA_DIR = dir;
  return dir;
});

import {
  __cliDetectionCacheStateForTests,
  __flushCliVersionCacheForTests,
  __resetCliDetectionCachesForTests,
  CLI_DETECTION_CACHE_MAX_ENTRIES,
  detectCliAsync,
  detectCodexCliAsync,
  isClaudeCliAuthenticatedAsync,
} from "./detect";

const tempRoots: string[] = [];
const originalPath = process.env.PATH;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/**
 * Fake codex that reports `version`, or `leakedVersion` when it can see the
 * backend's OPENAI_API_KEY — the probe environment must be sanitized.
 */
function makeCodexBinary(version: string, leakedVersion = version): string {
  const dir = makeTempDir("betterc0de codex detect-");
  const binaryPath = path.join(
    dir,
    process.platform === "win32" ? "codex.cmd" : "codex",
  );
  fs.writeFileSync(
    binaryPath,
    process.platform === "win32"
      ? `@echo off
if "%1"=="--version" (
  if defined OPENAI_API_KEY (echo ${leakedVersion}) else (echo ${version})
)
exit /b 0
`
      : `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write((process.env.OPENAI_API_KEY ? "${leakedVersion}" : "${version}") + "\\n");
  process.exit(0);
}
process.exit(0);
`,
    "utf8",
  );
  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

afterEach(async () => {
  await __flushCliVersionCacheForTests();
  __resetCliDetectionCachesForTests();
  process.env.PATH = originalPath;
  for (const [name, value] of [
    ["ANTHROPIC_API_KEY", originalAnthropicApiKey],
    ["OPENAI_API_KEY", originalOpenAiApiKey],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("detectCliAsync", () => {
  it("awaits an asynchronous authentication check", async () => {
    const binaryPath = makeCodexBinary("9.9.9");

    const status = await detectCliAsync(binaryPath, {
      refresh: true,
      isAuthenticated: async () => {
        await Promise.resolve();
        return false;
      },
      authType: "cli",
    });

    expect(status).toMatchObject({
      installed: true,
      version: "9.9.9",
      authenticated: false,
      authType: null,
    });
  });

  it("bounds detection cache cardinality for unique configured paths", async () => {
    const root = makeTempDir("betterc0de-cli-cache-bound-");
    for (let index = 0; index < CLI_DETECTION_CACHE_MAX_ENTRIES + 16; index += 1) {
      await detectCliAsync(path.join(root, `missing-${index}`), {
        refresh: true,
      });
    }

    expect(__cliDetectionCacheStateForTests()).toMatchObject({
      detectionEntries: CLI_DETECTION_CACHE_MAX_ENTRIES,
      inFlightEntries: 0,
    });
  });

  it("recognizes environment authentication without a credential-store process", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    await expect(isClaudeCliAuthenticatedAsync()).resolves.toBe(true);
  });

  it("does not interpolate configured binary names into a login shell", async () => {
    const marker = path.join(makeTempDir("betterc0de-cli-injection-"), "owned");
    const status = await detectCliAsync(`missing;touch ${marker}`, { refresh: true });

    expect(status.installed).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("probes binaries without the backend's provider credentials", async () => {
    process.env.OPENAI_API_KEY = "sk-must-not-leak";
    const binaryPath = makeCodexBinary("1.2.3", "9.9.9");

    const status = await detectCliAsync(binaryPath, { refresh: true });

    expect(status.installed).toBe(true);
    expect(status.version).toBe("1.2.3");
  });

  it("persists probed versions to the cache file asynchronously", async () => {
    const binaryPath = makeCodexBinary("4.5.6");
    await detectCliAsync(binaryPath, { refresh: true });
    await __flushCliVersionCacheForTests();

    const cacheFile = path.join(dataDir, "cli-version-cache.json");
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as Record<
      string,
      { version: string }
    >;
    const entry = Object.entries(parsed).find(([key]) =>
      key.toLowerCase().includes(path.basename(path.dirname(binaryPath)).toLowerCase()),
    );
    expect(entry?.[1].version).toBe("4.5.6");
  });
});

describe("detectCodexCliAsync", () => {
  it("skips a configured pre-app-server Codex binary when a newer CLI exists on PATH", async () => {
    const staleBinary = makeCodexBinary("0.2.3");
    const currentBinary = makeCodexBinary("9.9.9");
    process.env.PATH = `${path.dirname(currentBinary)}${path.delimiter}${originalPath ?? ""}`;

    const status = await detectCodexCliAsync(staleBinary, {
      refresh: true,
      isAuthenticated: () => true,
      authType: "cli",
    });

    expect(status).toMatchObject({
      installed: true,
      version: "9.9.9",
      binaryPath: fs.realpathSync.native(currentBinary),
      authenticated: true,
      authType: "cli",
    });
  });

  it("honors an app-server-capable configured binary from a path containing spaces", async () => {
    const configuredBinary = makeCodexBinary("9.8.7");
    const currentBinary = makeCodexBinary("9.9.9");
    process.env.PATH = `${path.dirname(currentBinary)}${path.delimiter}${originalPath ?? ""}`;

    const status = await detectCodexCliAsync(configuredBinary, { refresh: true });

    expect(configuredBinary).toContain(" ");
    expect(status.binaryPath).toBe(fs.realpathSync.native(configuredBinary));
    expect(status.version).toBe("9.8.7");
  });

  it("stores a stable real Codex binary path instead of a transient symlink", async () => {
    const realBinary = makeCodexBinary("9.9.9");
    const symlinkDir = makeTempDir("betterc0de-codex-detect-link-");
    const symlinkPath = path.join(symlinkDir, "codex");
    fs.symlinkSync(realBinary, symlinkPath);
    process.env.PATH = `${symlinkDir}${path.delimiter}${originalPath ?? ""}`;

    const status = await detectCodexCliAsync(null, { refresh: true });

    expect(status).toMatchObject({
      installed: true,
      version: "9.9.9",
      binaryPath: fs.realpathSync.native(realBinary),
    });
  });
});
