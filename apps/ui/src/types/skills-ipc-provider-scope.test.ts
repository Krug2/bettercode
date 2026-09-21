import { createRequire } from "node:module"
import * as path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const {
  manifestTargetsProvider,
  nativeSourceAlreadyLoadsSkill,
  resolveClaudeConfigDir,
} = require("../../../shell/skills-ipc.cjs") as {
  manifestTargetsProvider: (
    manifest: {
      providerKinds?: string[]
      providerInstanceIds?: string[]
    },
    provider: "codex" | "claude"
  ) => boolean
  nativeSourceAlreadyLoadsSkill: (
    manifest: { source?: string; sourcePath?: string },
    provider: "codex" | "claude"
  ) => boolean
  resolveClaudeConfigDir: () => string
}

describe("skills-ipc provider scope matching", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("targets native providers from provider kind aliases", () => {
    expect(
      manifestTargetsProvider({ providerKinds: ["codex-cli"] }, "codex")
    ).toBe(true)
    expect(
      manifestTargetsProvider({ providerKinds: ["claude-agent"] }, "claude")
    ).toBe(true)
  })

  it("targets native providers from provider instance ids", () => {
    expect(
      manifestTargetsProvider({ providerInstanceIds: ["codex_work"] }, "codex")
    ).toBe(true)
    expect(
      manifestTargetsProvider(
        { providerInstanceIds: ["claude-work"] },
        "claude"
      )
    ).toBe(true)
  })

  it("does not leak scopes across native providers", () => {
    expect(
      manifestTargetsProvider({ providerInstanceIds: ["claude-work"] }, "codex")
    ).toBe(false)
    expect(
      manifestTargetsProvider({ providerKinds: ["codex"] }, "claude")
    ).toBe(false)
    expect(
      manifestTargetsProvider(
        {
          providerKinds: ["claude"],
          providerInstanceIds: ["codex-work"],
        },
        "claude"
      )
    ).toBe(false)
  })

  it("treats CLAUDE_CONFIG_DIR as the exact native config directory", () => {
    const configured = path.join("tmp", "isolated-claude-profile")
    vi.stubEnv("CLAUDE_CONFIG_DIR", configured)

    expect(resolveClaudeConfigDir()).toBe(path.resolve(configured))
  })

  it("does not copy imported native skills back into another native root", () => {
    expect(
      nativeSourceAlreadyLoadsSkill(
        {
          source: "codex",
          sourcePath: path.join(
            "repo",
            ".agents",
            "skills",
            "review",
            "SKILL.md"
          ),
        },
        "codex"
      )
    ).toBe(true)
    expect(
      nativeSourceAlreadyLoadsSkill(
        {
          source: "claude",
          sourcePath: path.join(
            "repo",
            ".claude",
            "skills",
            "review",
            "SKILL.md"
          ),
        },
        "claude"
      )
    ).toBe(true)
    expect(
      nativeSourceAlreadyLoadsSkill(
        {
          source: "codex",
          sourcePath: path.join("repo", ".claude", "skills", "review"),
        },
        "codex"
      )
    ).toBe(false)
  })
})
