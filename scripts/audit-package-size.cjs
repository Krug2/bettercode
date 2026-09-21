#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const releaseDirArgIndex = args.indexOf("--release-dir");
const releaseDirFromArg = releaseDirArgIndex >= 0 ? args[releaseDirArgIndex + 1] : null;

const releaseDir = path.resolve(process.cwd(), releaseDirFromArg || process.env.PACKAGE_RELEASE_DIR || "release");
// Total package budget accommodates the bundled Anthropic Claude CLI binary
// (~242 MB inside app.asar.unpacked) plus the Electron/Chromium runtime
// (~212 MB BetterC0de.exe + ~80 MB DLLs/locales). Lower this only after
// `claude.exe` is migrated to a download-on-first-run flow in
// apps/shell/claude-provider.cjs — at which point ~280 MB total becomes
// the realistic target.
const sizeBudgetMb = Number(process.env.SIZE_BUDGET_MB || "650");
const asarBudgetMb = Number(process.env.ASAR_BUDGET_MB || "100");
const topFileCount = Number(process.env.SIZE_AUDIT_TOP_FILES || "15");

function bytesToMb(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function isDirectory(entryPath) {
  try {
    return fs.statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
  return files;
}

function dirSizeBytes(rootDir) {
  return walkFiles(rootDir).reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
}

function resolveAppRootFromAsar(asarPath) {
  const parent = path.dirname(asarPath); // .../Resources
  const grandParent = path.dirname(parent); // .../Contents OR .../<target>
  if (path.basename(parent).toLowerCase() === "resources" && path.basename(grandParent).toLowerCase() === "contents") {
    return path.dirname(grandParent); // .../<App>.app
  }
  return grandParent; // .../<target>-unpacked
}

function findAsarFiles(rootDir) {
  if (!isDirectory(rootDir)) return [];
  const files = walkFiles(rootDir);
  return files.filter((filePath) => path.basename(filePath).toLowerCase() === "app.asar");
}

function topFiles(rootDir, limit) {
  return walkFiles(rootDir)
    .map((filePath) => ({ file: path.relative(rootDir, filePath), bytes: fs.statSync(filePath).size }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit)
    .map((entry) => ({ ...entry, mb: bytesToMb(entry.bytes) }));
}

if (!isDirectory(releaseDir)) {
  console.error(`[size-audit] Release directory not found: ${releaseDir}`);
  process.exit(1);
}

const asarFiles = findAsarFiles(releaseDir);
if (asarFiles.length === 0) {
  console.error(`[size-audit] No app.asar found under ${releaseDir}`);
  process.exit(1);
}

const report = {
  generatedAt: new Date().toISOString(),
  releaseDir,
  budgets: {
    installedMb: sizeBudgetMb,
    appAsarMb: asarBudgetMb,
  },
  targets: [],
};

let hasBudgetViolation = false;

for (const asarPath of asarFiles) {
  const appRoot = resolveAppRootFromAsar(asarPath);
  const asarUnpackedPath = `${asarPath}.unpacked`;
  const appAsarBytes = fs.statSync(asarPath).size;
  const appRootBytes = dirSizeBytes(appRoot);
  const unpackedBytes = isDirectory(asarUnpackedPath) ? dirSizeBytes(asarUnpackedPath) : 0;

  const targetReport = {
    targetName: path.relative(releaseDir, appRoot) || path.basename(appRoot),
    appRoot,
    totalBytes: appRootBytes,
    totalMb: bytesToMb(appRootBytes),
    appAsarBytes,
    appAsarMb: bytesToMb(appAsarBytes),
    appAsarUnpackedBytes: unpackedBytes,
    appAsarUnpackedMb: bytesToMb(unpackedBytes),
    topFiles: topFiles(appRoot, topFileCount),
    budget: {
      installedMb: sizeBudgetMb,
      appAsarMb: asarBudgetMb,
    },
  };

  targetReport.withinBudget =
    targetReport.totalMb <= sizeBudgetMb && targetReport.appAsarMb <= asarBudgetMb;

  if (!targetReport.withinBudget) {
    hasBudgetViolation = true;
  }

  report.targets.push(targetReport);
}

const reportFile = path.join(releaseDir, "size-report.json");
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

for (const target of report.targets) {
  console.log(`\n[size-audit] Target: ${target.targetName}`);
  console.log(`  total: ${target.totalMb} MB (budget ${sizeBudgetMb} MB)`);
  console.log(`  app.asar: ${target.appAsarMb} MB (budget ${asarBudgetMb} MB)`);
  console.log(`  app.asar.unpacked: ${target.appAsarUnpackedMb} MB`);
  console.log("  top contributors:");
  for (const entry of target.topFiles.slice(0, 8)) {
    console.log(`    - ${entry.mb} MB  ${entry.file}`);
  }
}

console.log(`\n[size-audit] Report written: ${reportFile}`);

if (hasBudgetViolation) {
  console.error("[size-audit] Packaging budget violation detected.");
  process.exit(1);
}

console.log("[size-audit] All targets are within configured budgets.");
