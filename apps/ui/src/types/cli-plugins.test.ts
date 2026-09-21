import { createRequire } from "node:module"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const cliPlugins = require("../../../shell/cli-plugins.cjs") as {
  parseClaudeInstalledPlugins: (input: {
    installedPluginsJson: unknown
    enabledPluginsMap: unknown
  }) => Array<Record<string, unknown>>
  readClaudePluginComponents: (installPath: string) => {
    components: {
      skills: Array<{ name: string; description?: string; path?: string }>
      agents: Array<{ name: string }>
      commands: Array<{ name: string }>
      mcpServers: Array<{ name: string; transport?: string; url?: string }>
      hooks: string[]
    }
    description?: string
  }
  readCodexPluginComponents: (installPath: string) => {
    components: {
      skills: Array<{ name: string }>
      mcpServers: Array<{ name: string }>
    }
    description?: string
    interface?: { displayName?: string; brandColor?: string }
  }
  parseCodexPluginListJson: (stdout: string) => {
    installed: Array<Record<string, unknown>>
    available: Array<Record<string, unknown>>
  }
  parseCodexConfigTomlPlugins: (toml: string) => Array<Record<string, unknown>>
  normalizeWindowsInstallPath: (p: string) => string
  parseSkillFrontmatter: (md: string) => { name?: string; description?: string }
  isClaudePluginEnabled: (map: unknown, id: string) => boolean
  getCliPluginInventory: (opts: {
    force?: boolean
    runCli?: (
      bin: string,
      args: string[],
      opts?: Record<string, unknown>
    ) => Promise<{
      code: number | null
      stdout: string
      stderr: string
      timedOut: boolean
    }>
  }) => Promise<{
    claude: { cliDetected: boolean; plugins: Array<Record<string, unknown>> }
    codex: {
      cliDetected: boolean
      error?: string
      plugins: Array<Record<string, unknown>>
    }
  }>
  resolveClaudeConfigDir: () => string
}

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-cli-plugins-"))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("CLI config directory resolution", () => {
  it("uses CLAUDE_CONFIG_DIR as an exact directory", () => {
    const configured = path.join("tmp", "plugin-profile")
    vi.stubEnv("CLAUDE_CONFIG_DIR", configured)

    expect(cliPlugins.resolveClaudeConfigDir()).toBe(path.resolve(configured))
  })
})

describe("parseClaudeInstalledPlugins", () => {
  const registry = {
    version: 2,
    plugins: {
      "frontend-design@claude-plugins-official": [
        {
          scope: "user",
          installPath:
            "C:\\Users\\test\\.claude\\plugins\\cache\\claude-plugins-official\\frontend-design\\unknown",
          version: "unknown",
        },
      ],
      "figma@claude-plugins-official": [
        {
          scope: "project",
          installPath: "D:\\proj\\figma\\1.0.0",
          version: "1.0.0",
        },
        {
          scope: "user",
          installPath: "C:\\cache\\figma\\2.2.76",
          version: "2.2.76",
        },
      ],
    },
  }

  it("parses the v2 registry, preferring user-scoped installs", () => {
    const plugins = cliPlugins.parseClaudeInstalledPlugins({
      installedPluginsJson: registry,
      enabledPluginsMap: {
        "frontend-design@claude-plugins-official": true,
        "figma@claude-plugins-official": false,
      },
    })
    expect(plugins).toHaveLength(2)
    const frontend = plugins.find(
      (p) => p.id === "frontend-design@claude-plugins-official"
    )
    expect(frontend).toMatchObject({
      source: "claude",
      name: "frontend-design",
      marketplace: "claude-plugins-official",
      version: "unknown",
      enabled: true,
      scope: "user",
    })
    const figma = plugins.find((p) => p.id === "figma@claude-plugins-official")
    expect(figma).toMatchObject({
      version: "2.2.76",
      scope: "user",
      enabled: false,
      installPath: "C:\\cache\\figma\\2.2.76",
    })
  })

  it("treats plugins absent from the object map as enabled", () => {
    const plugins = cliPlugins.parseClaudeInstalledPlugins({
      installedPluginsJson: registry,
      enabledPluginsMap: {},
    })
    expect(plugins.every((p) => p.enabled === true)).toBe(true)
  })

  it("supports the legacy array shape of enabledPlugins", () => {
    const plugins = cliPlugins.parseClaudeInstalledPlugins({
      installedPluginsJson: registry,
      enabledPluginsMap: ["figma@claude-plugins-official"],
    })
    expect(
      plugins.find((p) => p.id === "figma@claude-plugins-official")?.enabled
    ).toBe(true)
    expect(
      plugins.find((p) => p.id === "frontend-design@claude-plugins-official")
        ?.enabled
    ).toBe(false)
  })

  it("returns [] for a missing or malformed registry", () => {
    expect(
      cliPlugins.parseClaudeInstalledPlugins({
        installedPluginsJson: null,
        enabledPluginsMap: {},
      })
    ).toEqual([])
    expect(
      cliPlugins.parseClaudeInstalledPlugins({
        installedPluginsJson: { plugins: "garbage" },
        enabledPluginsMap: {},
      })
    ).toEqual([])
  })
})

describe("readClaudePluginComponents", () => {
  it("inventories skills, agents, commands, hooks, and MCP servers", () => {
    const dir = makeTempDir()
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "demo", description: "Demo plugin" })
    )
    fs.mkdirSync(path.join(dir, "skills", "review"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "skills", "review", "SKILL.md"),
      '---\nname: review-helper\ndescription: "Reviews things"\n---\nbody'
    )
    fs.mkdirSync(path.join(dir, "agents"), { recursive: true })
    fs.writeFileSync(path.join(dir, "agents", "critic.md"), "agent body")
    fs.mkdirSync(path.join(dir, "commands", "git"), { recursive: true })
    fs.writeFileSync(path.join(dir, "commands", "top.md"), "cmd")
    fs.writeFileSync(path.join(dir, "commands", "git", "sync.md"), "cmd")
    fs.mkdirSync(path.join(dir, "hooks"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "hooks", "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [] } })
    )
    fs.writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          figma: { type: "http", url: "https://mcp.figma.com/mcp" },
        },
      })
    )

    const result = cliPlugins.readClaudePluginComponents(dir)
    expect(result.description).toBe("Demo plugin")
    expect(result.components.skills).toEqual([
      {
        name: "review-helper",
        description: "Reviews things",
        path: path.join(dir, "skills", "review"),
      },
    ])
    expect(result.components.agents).toEqual([{ name: "critic" }])
    expect(result.components.commands.map((c) => c.name).sort()).toEqual([
      "git/sync",
      "top",
    ])
    expect(result.components.hooks).toEqual(["PreToolUse"])
    expect(result.components.mcpServers).toEqual([
      { name: "figma", transport: "http", url: "https://mcp.figma.com/mcp" },
    ])
  })

  it("returns empty components for an empty directory", () => {
    const dir = makeTempDir()
    const result = cliPlugins.readClaudePluginComponents(dir)
    expect(result.components).toEqual({
      skills: [],
      agents: [],
      commands: [],
      mcpServers: [],
      hooks: [],
    })
  })
})

describe("readCodexPluginComponents", () => {
  it("reads the .codex-plugin manifest including the interface block", () => {
    const dir = makeTempDir()
    fs.mkdirSync(path.join(dir, ".codex-plugin"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "github",
        description: "GitHub workflows",
        mcpServers: "./.mcp.json",
        interface: {
          displayName: "GitHub",
          brandColor: "#24292F",
          logo: "./assets/logo.png",
        },
      })
    )
    fs.mkdirSync(path.join(dir, "skills", "gh-fix-ci"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, "skills", "gh-fix-ci", "SKILL.md"),
      "---\nname: gh-fix-ci\n---\nbody"
    )
    fs.writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ github: { command: "gh-mcp" } })
    )

    const result = cliPlugins.readCodexPluginComponents(dir)
    expect(result.description).toBe("GitHub workflows")
    expect(result.interface?.displayName).toBe("GitHub")
    expect(result.interface?.brandColor).toBe("#24292F")
    expect(result.components.skills.map((s) => s.name)).toEqual(["gh-fix-ci"])
    expect(result.components.mcpServers).toEqual([
      { name: "github", command: "gh-mcp" },
    ])
  })
})

describe("parseCodexPluginListJson", () => {
  it("parses installed and available plugins", () => {
    const stdout = JSON.stringify({
      installed: [
        {
          pluginId: "github@openai-curated",
          name: "github",
          marketplaceName: "openai-curated",
          version: "27126220",
          installed: true,
          enabled: true,
          source: {
            source: "local",
            path: "\\\\?\\C:\\Users\\test\\.codex\\.tmp\\plugins\\plugins\\github",
          },
        },
      ],
      available: [
        { pluginId: "linear@openai-curated", name: "linear", enabled: false },
      ],
    })
    const result = cliPlugins.parseCodexPluginListJson(stdout)
    expect(result.installed).toHaveLength(1)
    expect(result.installed[0]).toMatchObject({
      source: "codex",
      id: "github@openai-curated",
      marketplace: "openai-curated",
      enabled: true,
      installPath: "C:\\Users\\test\\.codex\\.tmp\\plugins\\plugins\\github",
    })
    expect(result.available[0]).toMatchObject({
      id: "linear@openai-curated",
      enabled: false,
    })
  })

  it("throws on non-JSON stdout", () => {
    expect(() => cliPlugins.parseCodexPluginListJson("error: boom")).toThrow(
      /non-JSON/
    )
  })
})

describe("parseCodexConfigTomlPlugins", () => {
  it("extracts plugin ids and enabled flags from config.toml sections", () => {
    const toml = [
      'model = "gpt-5.5"',
      "",
      "# plugins",
      '[plugins."github@openai-curated"]',
      "enabled = true",
      "",
      '[plugins."browser@openai-bundled"]',
      "enabled = false",
      "",
      "[mcp_servers.figma]",
      'command = "figma-mcp"',
    ].join("\n")
    const plugins = cliPlugins.parseCodexConfigTomlPlugins(toml)
    expect(plugins).toHaveLength(2)
    expect(plugins[0]).toMatchObject({
      id: "github@openai-curated",
      enabled: true,
    })
    expect(plugins[1]).toMatchObject({
      id: "browser@openai-bundled",
      enabled: false,
    })
  })

  it("returns [] for empty input", () => {
    expect(cliPlugins.parseCodexConfigTomlPlugins("")).toEqual([])
  })
})

describe("small helpers", () => {
  it("normalizeWindowsInstallPath strips the extended-length prefix", () => {
    expect(cliPlugins.normalizeWindowsInstallPath("\\\\?\\C:\\x")).toBe("C:\\x")
    expect(cliPlugins.normalizeWindowsInstallPath("C:\\x")).toBe("C:\\x")
  })

  it("parseSkillFrontmatter reads name/description and tolerates quotes", () => {
    expect(
      cliPlugins.parseSkillFrontmatter(
        "---\nname: pdf\ndescription: 'Handles PDFs'\n---\n# body"
      )
    ).toEqual({ name: "pdf", description: "Handles PDFs" })
    expect(cliPlugins.parseSkillFrontmatter("no frontmatter")).toEqual({})
  })

  it("isClaudePluginEnabled handles map, array, and absent shapes", () => {
    expect(cliPlugins.isClaudePluginEnabled({ a: false }, "a")).toBe(false)
    expect(cliPlugins.isClaudePluginEnabled({ a: false }, "b")).toBe(true)
    expect(cliPlugins.isClaudePluginEnabled(["a"], "a")).toBe(true)
    expect(cliPlugins.isClaudePluginEnabled(["a"], "b")).toBe(false)
    expect(cliPlugins.isClaudePluginEnabled(undefined, "a")).toBe(true)
  })
})

describe("patchCodexConfigTomlEnabled", () => {
  const patch = (
    cliPlugins as unknown as {
      patchCodexConfigTomlEnabled: (
        toml: string,
        id: string,
        enabled: boolean
      ) => string
    }
  ).patchCodexConfigTomlEnabled

  const toml = [
    'model = "gpt-5.5"',
    "",
    "# my plugins",
    '[plugins."github@openai-curated"]',
    "enabled = true",
    "",
    '[plugins."browser@openai-bundled"]',
    "enabled = false",
    "",
    "[mcp_servers.figma]",
    'command = "figma-mcp"',
    "",
  ].join("\n")

  it("flips only the targeted section's enabled line", () => {
    const result = patch(toml, "github@openai-curated", false)
    expect(result).toBe(
      toml.replace(
        '[plugins."github@openai-curated"]\nenabled = true',
        '[plugins."github@openai-curated"]\nenabled = false'
      )
    )
    // Unrelated section untouched.
    expect(result).toContain(
      '[plugins."browser@openai-bundled"]\nenabled = false'
    )
    expect(result).toContain("# my plugins")
    expect(result).toContain('command = "figma-mcp"')
  })

  it("inserts the enabled key when the section lacks one", () => {
    const noKey = '[plugins."x@mp"]\nfoo = 1\n\n[other]\n'
    expect(patch(noKey, "x@mp", false)).toBe(
      '[plugins."x@mp"]\nenabled = false\nfoo = 1\n\n[other]\n'
    )
  })

  it("appends a new section when the plugin has none", () => {
    expect(patch('model = "gpt-5.5"\n', "new@mp", true)).toBe(
      'model = "gpt-5.5"\n\n[plugins."new@mp"]\nenabled = true\n'
    )
    expect(patch("", "new@mp", true)).toBe(
      '[plugins."new@mp"]\nenabled = true\n'
    )
  })

  it("preserves CRLF line endings", () => {
    const crlf = '[plugins."a@mp"]\r\nenabled = true\r\n'
    expect(patch(crlf, "a@mp", false)).toBe(
      '[plugins."a@mp"]\r\nenabled = false\r\n'
    )
  })

  it("is a no-op string change when the value already matches", () => {
    expect(patch(toml, "github@openai-curated", true)).toBe(toml)
  })
})

describe("validateCliPluginId", () => {
  const validate = (
    cliPlugins as unknown as { validateCliPluginId: (id: string) => string }
  ).validateCliPluginId

  it("accepts canonical plugin ids", () => {
    expect(validate("github@openai-curated")).toBe("github@openai-curated")
    expect(validate("frontend-design@claude-plugins-official")).toBe(
      "frontend-design@claude-plugins-official"
    )
    expect(validate("typescript-lsp@claude-plugins-official")).toBe(
      "typescript-lsp@claude-plugins-official"
    )
  })

  it("rejects flag-like and shell-metacharacter ids", () => {
    expect(() => validate("--dangerously-bypass")).toThrow(/Invalid/)
    expect(() => validate("-rf")).toThrow(/Invalid/)
    expect(() => validate("a; rm -rf ~")).toThrow(/Invalid/)
    expect(() => validate("a|b")).toThrow(/Invalid/)
    expect(() => validate("a b")).toThrow(/Invalid/)
    expect(() => validate("")).toThrow(/required/)
  })
})

describe("getCliPluginInventory (codex path, injected runCli)", () => {
  it("uses codex plugin list --json output without spawning anything real", async () => {
    const calls: Array<{ bin: string; args: string[] }> = []
    const inventory = await cliPlugins.getCliPluginInventory({
      force: true,
      runCli: async (bin, args) => {
        calls.push({ bin, args })
        return {
          code: 0,
          stdout: JSON.stringify({
            installed: [
              {
                pluginId: "vercel@openai-curated",
                name: "vercel",
                marketplaceName: "openai-curated",
                version: "1",
                enabled: true,
                source: { source: "local", path: makeTempDir() },
              },
            ],
            available: [],
          }),
          stderr: "",
          timedOut: false,
        }
      },
    })
    // The codex binary may or may not exist on the machine running the
    // tests; when it does, our fake runCli must have been used.
    if (inventory.codex.cliDetected) {
      expect(calls).toHaveLength(1)
      expect(calls[0]!.args).toEqual(["plugin", "list", "--json"])
      expect(inventory.codex.plugins.map((p) => p.id)).toEqual([
        "vercel@openai-curated",
      ])
      expect(inventory.codex.error).toBeUndefined()
    } else {
      expect(calls).toHaveLength(0)
    }
  })

  it("degrades to the config.toml fallback when the CLI errors", async () => {
    const inventory = await cliPlugins.getCliPluginInventory({
      force: true,
      runCli: async () => ({
        code: 1,
        stdout: "",
        stderr: "boom",
        timedOut: false,
      }),
    })
    if (inventory.codex.cliDetected) {
      expect(inventory.codex.error).toMatch(/exited with code 1/)
    }
  })
})
