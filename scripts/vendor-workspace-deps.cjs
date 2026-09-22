#!/usr/bin/env node

// [PACKAGING] Replaces npm-workspace symlinks under `node_modules/@betterc0de/`
// with real on-disk copies before electron-builder runs.
//
// WHY: electron-builder follows symlinks to the target path and packs the
// content there (e.g. `packages/schema/`), NOT at the symlink path
// (`node_modules/@betterc0de/schema/`). Node's `require('@betterc0de/schema')`
// only resolves through `node_modules/`, so the packaged backend cannot find
// the workspace package — backend exits with code 1 on first DB call.
//
// This script vendors a real directory copy at the symlink path, packed
// directly into the asar via the existing `node_modules/@betterc0de/**/*`
// glob in package.json. Pair with `restore-workspace-deps.cjs`, which
// re-creates the symlinks after packaging so dev workflow stays intact.
//
// Idempotent: if the path is already a real directory, no-op.

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

// Only schema is required at backend runtime — confirmed by grepping
// `apps/backend/dist/` for external requires. Other workspace-package
// symlinks (shell, ui, util, backend) under @betterc0de/ aren't loaded
// from `node_modules/`, so we leave them alone.
const VENDORED_PACKAGES = [
  {
    pkgDir: path.join(repoRoot, "node_modules", "@claudart", "orchestrator"),
    sourceDir: path.join(repoRoot, "packages", "claudart-orchestrator"),
    name: "@claudart/orchestrator",
  },
  {
    pkgDir: path.join(repoRoot, "node_modules", "@betterc0de", "schema"),
    sourceDir: path.join(repoRoot, "packages", "schema"),
    name: "@betterc0de/schema",
  },
];

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
    else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try { fs.symlinkSync(target, d); } catch { /* tolerate */ }
    }
  }
}

let vendored = 0;
let skipped = 0;

for (const { pkgDir, sourceDir, name } of VENDORED_PACKAGES) {
  if (!fs.existsSync(pkgDir)) {
    console.error(`[vendor-workspace-deps] missing ${pkgDir} — skipping`);
    continue;
  }
  const stat = fs.lstatSync(pkgDir);
  if (!stat.isSymbolicLink()) {
    skipped++;
    continue;
  }
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`[vendor-workspace-deps] symlink target missing: ${sourceDir}`);
  }
  fs.unlinkSync(pkgDir);
  copyDirSync(sourceDir, pkgDir);
  vendored++;
  console.log(`[vendor-workspace-deps] vendored ${name}: ${sourceDir} -> ${pkgDir}`);
}

console.log(`[vendor-workspace-deps] vendored=${vendored} skipped=${skipped}`);
