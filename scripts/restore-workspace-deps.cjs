#!/usr/bin/env node

// [PACKAGING] Reverses `vendor-workspace-deps.cjs`. After electron-builder
// finishes (success or failure), this restores npm-workspace symlinks so
// dev workflow (`npm run dev`) still resolves through `node_modules/`.
//
// On Windows, junctions don't require admin; on macOS/Linux a regular symlink
// works. Both are recreated with absolute targets matching the original npm
// workspace layout.

const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

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

let restored = 0;
let skipped = 0;

for (const { pkgDir, sourceDir, name } of VENDORED_PACKAGES) {
  if (fs.existsSync(pkgDir)) {
    const stat = fs.lstatSync(pkgDir);
    if (stat.isSymbolicLink()) {
      skipped++;
      continue;
    }
    fs.rmSync(pkgDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
  const linkType = os.platform() === "win32" ? "junction" : "dir";
  fs.symlinkSync(sourceDir, pkgDir, linkType);
  restored++;
  console.log(`[restore-workspace-deps] restored symlink ${name}: ${pkgDir} -> ${sourceDir}`);
}

console.log(`[restore-workspace-deps] restored=${restored} skipped=${skipped}`);
