import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Pins the shape of the backend composition root after the `startNodeBackend`
 * split. `inProcess.ts` is meant to read as the one ordered list of startup
 * phases; the phases themselves live in `bootstrap/` and only meet through
 * the context types. These rules are cheap to break by accident (one helper
 * import, one shared constant) and expensive to notice later, so they are
 * asserted from the source text rather than trusted.
 */

const backendSrc = path.resolve(__dirname, "..")
const bootstrapDir = __dirname

/** Ratchet: lower it when `inProcess.ts` shrinks, never raise it to pass. */
const IN_PROCESS_MAX_LINES = 300

/**
 * Everything `inProcess.ts` may import. It is the composition root, so it
 * knows the phases and the few shared primitives — and nothing else: a
 * service imported here is a phase that leaked back into the root.
 */
const IN_PROCESS_IMPORT_ALLOWLIST = [
  /^node:/u,
  /^\.\/bootstrap\/[a-z-]+$/u,
  /^\.\/config$/u,
  /^\.\/shutdown$/u,
  /^\.\/observability\/logger$/u,
]

/**
 * Phase modules may not import each other; the only intra-`bootstrap/`
 * imports allowed are the shared types (`context`), the phase-0 primitives
 * every later phase and the unwind need (`lifecycle`) and the pure env
 * helpers (`env`).
 */
const BOOTSTRAP_SHARED_MODULES = new Set(["./context", "./lifecycle", "./env"])

/**
 * Every module specifier the file imports or re-exports. Prettier wraps long
 * import lists across lines, so the clause is matched across newlines: a
 * single-line-only regex would let `import {\n  x\n} from "./providers"`
 * through and make the independence rules below hollow. Comments are
 * stripped first so a mention inside a `//` note is not counted.
 */
export function importSpecifiers(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "")
  const specifiers = new Set<string>()
  const clauses =
    /^(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gmu
  for (const match of withoutComments.matchAll(clauses)) {
    const specifier = match[1] ?? match[2]
    if (specifier) specifiers.add(specifier)
  }
  return [...specifiers]
}

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts")
    )
    .map((entry) => path.join(dir, entry.name))
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(fullPath))
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(fullPath)
    }
  }
  return out
}

describe("importSpecifiers", () => {
  it("sees multi-line import clauses and ignores commented ones", () => {
    const source = [
      'import a from "./a"',
      "import {",
      "  b,",
      "  c,",
      '} from "./b"',
      'export type { D } from "./d"',
      'import "./side-effect"',
      '// import x from "./commented"',
      '/* import y from "./blocked" */',
    ].join("\n")
    expect(importSpecifiers(source).sort()).toEqual(
      ["./a", "./b", "./d", "./side-effect"].sort()
    )
  })
})

describe("backend bootstrap structure", () => {
  const inProcessPath = path.join(backendSrc, "inProcess.ts")
  const inProcessSource = fs.readFileSync(inProcessPath, "utf8")

  it(`keeps inProcess.ts at or under ${IN_PROCESS_MAX_LINES} lines`, () => {
    const lineCount = inProcessSource.split("\n").length
    expect(lineCount).toBeLessThanOrEqual(IN_PROCESS_MAX_LINES)
  })

  it("lets inProcess.ts import only the phases and shared primitives", () => {
    const offenders = importSpecifiers(inProcessSource).filter(
      (specifier) =>
        !IN_PROCESS_IMPORT_ALLOWLIST.some((pattern) => pattern.test(specifier))
    )
    expect(offenders).toEqual([])
  })

  it("keeps phase modules independent of each other", () => {
    const offenders = sourceFiles(bootstrapDir).flatMap((file) => {
      const source = fs.readFileSync(file, "utf8")
      return importSpecifiers(source)
        .filter(
          (specifier) =>
            specifier.startsWith("./") && !BOOTSTRAP_SHARED_MODULES.has(specifier)
        )
        .map((specifier) => `${path.basename(file)} -> ${specifier}`)
    })
    expect(offenders).toEqual([])
  })

  it("keeps the shared modules free of phase imports", () => {
    // `context` is types only and `env` is pure; neither may pull a phase
    // in, or the "no phase imports a phase" rule above would be hollow.
    for (const name of ["context.ts", "env.ts"]) {
      const source = fs.readFileSync(path.join(bootstrapDir, name), "utf8")
      const local = importSpecifiers(source).filter((specifier) =>
        specifier.startsWith("./")
      )
      expect(local, name).toEqual([])
    }
  })

  it("confines the shutdown hard timeout to constants.ts and bootstrap/shutdown.ts", () => {
    const users = walkSourceFiles(backendSrc)
      .filter((file) =>
        fs.readFileSync(file, "utf8").includes("SHUTDOWN_HARD_TIMEOUT_MS")
      )
      .map((file) => path.relative(backendSrc, file).split(path.sep).join("/"))
      .sort()
    expect(users).toEqual(["bootstrap/shutdown.ts", "constants.ts"])
  })
})
