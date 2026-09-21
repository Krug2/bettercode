import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(__dirname, "../../../../..")
const packageManifestFiles = [
  "package.json",
  "package-lock.json",
  "apps/backend/package.json",
  "apps/ui/package.json",
  "packages/schema/package.json",
]

function readJsonFile(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
  ) as unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function dependencyNamesFromManifest(
  manifest: Record<string, unknown>
): string[] {
  return [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].flatMap((key) => Object.keys(asRecord(manifest[key])))
}

function isBetterC0dePackageName(name: string): boolean {
  return (
    name === "BetterC0de" ||
    name.startsWith("BetterC0de-") ||
    name.startsWith("@BetterC0de-ai/")
  )
}

describe("BetterC0de dependency boundary", () => {
  it("does not declare BetterC0de npm packages in app or workspace manifests", () => {
    for (const relativePath of packageManifestFiles) {
      if (!fs.existsSync(path.join(repoRoot, relativePath))) continue
      const manifest = asRecord(readJsonFile(relativePath))
      expect(
        dependencyNamesFromManifest(manifest).filter(isBetterC0dePackageName),
        `${relativePath} must not depend on BetterC0de packages`
      ).toEqual([])
    }
  })

  it("does not lock BetterC0de npm packages transitively", () => {
    const lock = asRecord(readJsonFile("package-lock.json"))
    const packages = asRecord(lock.packages)
    const lockedPackageNames = Object.keys(packages)
      .filter((key) => key.startsWith("node_modules/"))
      .map((key) => key.slice("node_modules/".length))

    expect(lockedPackageNames.filter(isBetterC0dePackageName)).toEqual([])
  })

  it("does not import BetterC0de packages from production source", () => {
    const sourceRoots = [
      "apps/backend/src",
      "apps/shell",
      "apps/ui/src",
      "packages/schema/src",
    ]
    const sourceFiles = sourceRoots.flatMap((root) =>
      walkFiles(path.join(repoRoot, root)).filter((file) =>
        /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(file)
      )
    )
    const importPattern =
      /\b(?:from\s+["']|import\s*\(\s*["']|require\s*\(\s*["'])(@BetterC0de-ai\/[^"']+|BetterC0de(?:-[^"']+)?)["']/u

    const offenders = sourceFiles
      .filter((file) => !/(?:^|[./])[^/]+\.test\.[cm]?[tj]sx?$/u.test(file))
      .flatMap((file) => {
        const text = fs.readFileSync(file, "utf8")
        return importPattern.test(text) ? [path.relative(repoRoot, file)] : []
      })

    expect(offenders).toEqual([])
  })
})

function walkFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath))
    } else if (entry.isFile()) {
      out.push(fullPath)
    }
  }
  return out
}
