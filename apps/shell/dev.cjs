// Wait for Vite to write its port to a temp file, then start Electron.
//
// Runs under both Node and Bun — the `npm run dev` entry invokes this via
// `node`, and `npm run dev:bun` invokes it via `bun`. The two runtimes
// differ in which package-runner ships with them: Node has `npx`, Bun has
// `bunx`. We detect the active runtime and pick the matching launcher so
// a bun-only environment (no Node on PATH) still works.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

// Two `..` here: shell now lives at apps/shell/, so to reach the repo
// root (where Vite writes the .vite-port file) we go up apps/shell → apps
// → repo root.
const repoRoot = path.join(__dirname, "..", "..");
const portFile = path.join(repoRoot, ".vite-port");
const isBun = typeof process.versions === "object" && typeof process.versions.bun === "string";
const runnerCmd = isBun ? "bunx" : "npx";

function ensureNodeNativeModules() {
  // The wrapper loads its native binding lazily when a database is opened.
  const checkArgs = ["-e", "new (require('better-sqlite3'))(':memory:').close()"];
  const check = spawnSync(process.execPath, checkArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (check.status === 0) return;

  console.warn("[dev] better-sqlite3 is not built for this Node runtime; rebuilding...");
  if (check.stderr) console.warn(check.stderr.trim());

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const rebuild = spawnSync(npmCmd, ["rebuild", "better-sqlite3"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, BETTERC0DE_SKIP_POSTINSTALL: "1" },
  });

  if (rebuild.error) {
    console.error("[dev] npm rebuild better-sqlite3 failed:", rebuild.error.message);
    process.exit(1);
  }
  if (rebuild.status !== 0) {
    console.error(`[dev] npm rebuild better-sqlite3 exited ${rebuild.status}`);
    process.exit(rebuild.status || 1);
  }

  const verify = spawnSync(process.execPath, checkArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (verify.status !== 0) {
    console.error("[dev] better-sqlite3 still cannot load after npm rebuild.");
    if (verify.stderr) console.error(verify.stderr.trim());
    process.exit(verify.status || 1);
  }
}

// Clean up old port file (ENOENT is expected when the file was never created)
try {
  fs.unlinkSync(portFile);
} catch (err) {
  if (err && err.code !== "ENOENT") console.warn("[dev] could not remove stale port file:", err.message);
}

async function waitAndStart() {
  ensureNodeNativeModules();

  // Wait 3s for Vite to start
  await new Promise(r => setTimeout(r, 3000));

  // Check a wide range — OS assigns random high port with port:0
  for (let attempt = 0; attempt < 60; attempt++) {
    // Check the port file first (ENOENT during startup is expected while we
    // wait for Vite to write it; any other error is worth surfacing).
    try {
      const port = parseInt(fs.readFileSync(portFile, "utf8").trim());
      if (port > 0) {
        console.log(`[dev] Found Vite port ${port} from file, starting Electron via ${runnerCmd}...`);
        spawn(runnerCmd, ["electron", "."], {
          stdio: "inherit",
          // `shell: true` is required on Windows so npx/bunx resolve their
          // `.cmd` shims; on macOS/Linux they're real executables and the
          // extra `/bin/sh -c` wrapper just adds another layer of quoting
          // pain (cwd has spaces like `bettercode`).
          shell: process.platform === "win32",
          // `electron .` resolves the Electron entry from the workspace
          // root's package.json (`main: "apps/shell/main.cjs"`), so we
          // launch from the repo root — two levels up from apps/shell.
          cwd: repoRoot,
          env: {
            ...process.env,
            VITE_DEV_PORT: String(port),
            BETTERC0DE_DEV_NODE_EXEC_PATH: process.execPath,
            // The root dev command runs `tsc --watch` for the backend. The
            // Electron host watches those emitted files and replaces only
            // the sidecar, keeping the renderer/window alive.
            BETTERC0DE_BACKEND_WATCH: "1",
          },
        });
        return;
      }
    } catch (err) {
      if (err && err.code !== "ENOENT") {
        console.warn(`[dev] error reading port file (attempt ${attempt + 1}):`, err.message);
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.error("[dev] Could not determine Vite port");
  process.exit(1);
}

waitAndStart();
