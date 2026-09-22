import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const skillsSh = require("../../../shell/skills-sh.cjs") as {
  validateSkillsShSource: (input: string) => string
  validateSkillName: (name?: string) => string | undefined
  parseSkillsShListOutput: (stdout: string) => string[]
  mapRegistryEntry: (raw: unknown) => {
    id: string
    skillId: string
    name: string
    source: string
    installs: number
  } | null
  skillsShAdd: (
    input: { repo: string; skill?: string },
    options?: {
      runCli?: (
        bin: string,
        args: string[],
        opts?: Record<string, unknown>
      ) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>
    }
  ) => Promise<{ installed: Array<{ target: string; name: string }> }>
}

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-skills-sh-"))
  tempDirs.push(dir)
  return dir
}

const savedEnv = {
  path: process.env.PATH,
  claude: process.env.CLAUDE_CONFIG_DIR,
  codex: process.env.CODEX_HOME,
}

afterEach(() => {
  if (savedEnv.path === undefined) delete process.env.PATH
  else process.env.PATH = savedEnv.path
  if (savedEnv.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedEnv.claude
  if (savedEnv.codex === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = savedEnv.codex
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe("validateSkillsShSource", () => {
  it("accepts owner/repo shorthand and github URLs", () => {
    expect(skillsSh.validateSkillsShSource("anthropics/skills")).toBe(
      "anthropics/skills"
    )
    expect(skillsSh.validateSkillsShSource("vercel-labs/agent-skills")).toBe(
      "vercel-labs/agent-skills"
    )
    expect(
      skillsSh.validateSkillsShSource(
        "https://github.com/vercel-labs/skills/tree/main/skills/find-skills"
      )
    ).toBe("https://github.com/vercel-labs/skills/tree/main/skills/find-skills")
  })

  it("rejects argv-injection and malformed sources", () => {
    expect(() => skillsSh.validateSkillsShSource("-rf")).toThrow(/Invalid/)
    expect(() => skillsSh.validateSkillsShSource("--copy")).toThrow(/Invalid/)
    expect(() => skillsSh.validateSkillsShSource("foo/bar; rm -rf ~")).toThrow(
      /Invalid/
    )
    expect(() => skillsSh.validateSkillsShSource("foo bar/baz")).toThrow(
      /Invalid/
    )
    // Credentialed URLs don't match the strict `https://github.com/` prefix
    // and are rejected by the generic branch.
    expect(() =>
      skillsSh.validateSkillsShSource("https://user:pw@github.com/a/b")
    ).toThrow(/Invalid/)
    expect(() =>
      skillsSh.validateSkillsShSource("https://evil.example.com/a/b")
    ).toThrow(/Invalid/)
    expect(() => skillsSh.validateSkillsShSource("")).toThrow(/required/)
    expect(() => skillsSh.validateSkillsShSource("just-a-name")).toThrow(
      /Invalid/
    )
  })
})

describe("validateSkillName", () => {
  it("accepts simple names, '*' and empty", () => {
    expect(skillsSh.validateSkillName("pdf")).toBe("pdf")
    expect(skillsSh.validateSkillName("react-best-practices")).toBe(
      "react-best-practices"
    )
    expect(skillsSh.validateSkillName("*")).toBe("*")
    expect(skillsSh.validateSkillName(undefined)).toBeUndefined()
    expect(skillsSh.validateSkillName("")).toBeUndefined()
  })

  it("rejects flag-like names", () => {
    expect(() => skillsSh.validateSkillName("-s")).toThrow(/Invalid/)
    expect(() => skillsSh.validateSkillName("a b")).toThrow(/Invalid/)
  })
})

describe("parseSkillsShListOutput", () => {
  const ESC = "\u001b"

  it("extracts cyan-highlighted skill names from real CLI output", () => {
    // Captured from `npx skills add vercel-labs/agent-skills -l` (v1.5.15).
    const stdout = [
      `${ESC}[32mo${ESC}[39m  ${ESC}[1mAvailable Skills${ESC}[22m`,
      `${ESC}[90m|${ESC}[39m`,
      `${ESC}[90m|${ESC}[39m    ${ESC}[36mvercel-composition-patterns${ESC}[39m`,
      `${ESC}[90m|${ESC}[39m`,
      `${ESC}[90m|${ESC}[39m      ${ESC}[2mReact composition patterns that scale.${ESC}[22m`,
      `${ESC}[90m|${ESC}[39m    ${ESC}[36mweb-design-guidelines${ESC}[39m`,
      `${ESC}[90m—${ESC}[39m  Use --skill <name> to install specific skills`,
    ].join("\n")
    expect(skillsSh.parseSkillsShListOutput(stdout)).toEqual([
      "vercel-composition-patterns",
      "web-design-guidelines",
    ])
  })

  it("falls back to indented name-only lines without ANSI colors", () => {
    const stdout = [
      "o  Available Skills",
      "|",
      "|    react-best-practices",
      "|",
      "|      React and Next.js performance optimization guidelines.",
      "|    nextjs-best-practices",
      "",
      "Fetching done",
    ].join("\n")
    expect(skillsSh.parseSkillsShListOutput(stdout)).toEqual([
      "react-best-practices",
      "nextjs-best-practices",
    ])
  })

  it("returns [] for empty output", () => {
    expect(skillsSh.parseSkillsShListOutput("")).toEqual([])
  })
})

describe("mapRegistryEntry", () => {
  it("maps /api/search entries and validates source + slug", () => {
    expect(
      skillsSh.mapRegistryEntry({
        id: "vercel-labs/agent-skills/vercel-react-best-practices",
        skillId: "vercel-react-best-practices",
        name: "vercel-react-best-practices",
        source: "vercel-labs/agent-skills",
        installs: 538551,
      })
    ).toEqual({
      id: "vercel-labs/agent-skills/vercel-react-best-practices",
      skillId: "vercel-react-best-practices",
      name: "vercel-react-best-practices",
      source: "vercel-labs/agent-skills",
      installs: 538551,
    })
    // Category-nested slugs with ":" are valid.
    expect(
      skillsSh.mapRegistryEntry({
        skillId: "react:components",
        name: "react:components",
        source: "google-labs-code/stitch-skills",
        installs: 1,
      })?.skillId
    ).toBe("react:components")
  })

  it("drops malformed or injection-shaped entries", () => {
    expect(
      skillsSh.mapRegistryEntry({ skillId: "-rf", source: "a/b", installs: 0 })
    ).toBeNull()
    expect(
      skillsSh.mapRegistryEntry({ skillId: "x", source: "not-a-repo", installs: 0 })
    ).toBeNull()
    expect(skillsSh.mapRegistryEntry(null)).toBeNull()
  })
})

describe("skillsShAdd (injected runCli, temp CLI homes)", () => {
  beforeEach(() => {
    const directory = makeTempDir()
    const binary = path.join(directory, process.platform === "win32" ? "npx.cmd" : "npx")
    fs.writeFileSync(binary, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    process.env.PATH = `${directory}${path.delimiter}${savedEnv.path ?? ""}`
  })

  it("reports newly created skill dirs across both CLI homes", async () => {
    const claudeHome = path.join(makeTempDir(), ".claude")
    const codexHome = makeTempDir()
    fs.mkdirSync(path.join(claudeHome, "skills", "existing"), {
      recursive: true,
    })
    fs.mkdirSync(path.join(codexHome, "skills"), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = claudeHome
    process.env.CODEX_HOME = codexHome

    const calls: string[][] = []
    const result = await skillsSh.skillsShAdd(
      { repo: "anthropics/skills", skill: "pdf" },
      {
        runCli: async (_bin, args) => {
          calls.push(args)
          // Simulate the skills CLI copying the skill into both homes.
          fs.mkdirSync(path.join(claudeHome, "skills", "pdf"), {
            recursive: true,
          })
          fs.mkdirSync(path.join(codexHome, "skills", "pdf"), {
            recursive: true,
          })
          return { code: 0, stdout: "done", stderr: "", timedOut: false }
        },
      }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      "-y",
      "skills",
      "add",
      "anthropics/skills",
      "-g",
      "-y",
      "--copy",
      "-a",
      "claude-code",
      "-a",
      "codex",
      "-s",
      "pdf",
    ])
    expect(result.installed.sort((a, b) => a.target.localeCompare(b.target)))
      .toEqual([
        { target: "claude", name: "pdf" },
        { target: "codex", name: "pdf" },
      ])
  })

  it("throws with the stderr tail on CLI failure", async () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(makeTempDir(), ".claude")
    process.env.CODEX_HOME = makeTempDir()
    await expect(
      skillsSh.skillsShAdd(
        { repo: "anthropics/skills" },
        {
          runCli: async () => ({
            code: 1,
            stdout: "",
            stderr: "repo not found",
            timedOut: false,
          }),
        }
      )
    ).rejects.toThrow(/repo not found/)
  })
})
