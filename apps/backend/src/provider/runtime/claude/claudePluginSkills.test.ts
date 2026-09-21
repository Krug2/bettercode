import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  listClaudePluginSkills,
  parseSkillMarkdownMetadata,
  readClaudeSkill,
} from "./claudePluginSkills"

const tempRoots: string[] = []

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop()
    if (!dir) continue
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

function writePluginSkill(
  pluginDir: string,
  skillName: string,
  frontmatter: string
): void {
  const skillDir = path.join(pluginDir, "skills", skillName)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), frontmatter)
}

function makeConfigDir(input: {
  plugins: Record<string, { installPath: string; scope?: string }>
  enabledPlugins?: unknown
}): string {
  const configDir = makeTempDir("betterc0de-claude-config-")
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true })
  fs.writeFileSync(
    path.join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: Object.fromEntries(
        Object.entries(input.plugins).map(([id, install]) => [
          id,
          [{ scope: install.scope ?? "user", installPath: install.installPath }],
        ])
      ),
    })
  )
  if (input.enabledPlugins !== undefined) {
    fs.writeFileSync(
      path.join(configDir, "settings.json"),
      JSON.stringify({ enabledPlugins: input.enabledPlugins })
    )
  }
  return configDir
}

describe("listClaudePluginSkills", () => {
  it("lists skills of enabled plugins with pluginId attribution", async () => {
    const pluginDir = makeTempDir("betterc0de-claude-plugin-")
    writePluginSkill(
      pluginDir,
      "web-design",
      "---\nname: web-design\ndescription: Design review\n---\nbody"
    )
    writePluginSkill(pluginDir, "a11y", "---\nname: a11y\n---\nbody")
    const configDir = makeConfigDir({
      plugins: { "frontend-design@claude-plugins-official": { installPath: pluginDir } },
      enabledPlugins: { "frontend-design@claude-plugins-official": true },
    })

    const skills = await listClaudePluginSkills(configDir)
    expect(skills.map((skill) => skill.name)).toEqual(["a11y", "web-design"])
    for (const skill of skills) {
      expect(skill.pluginId).toBe("frontend-design@claude-plugins-official")
      expect(skill.scope).toBe("plugin")
      expect(skill.enabled).toBe(true)
    }
    expect(
      skills.find((skill) => skill.name === "web-design")?.description
    ).toBe("Design review")
  })

  it("skips plugins disabled in the settings map", async () => {
    const enabledDir = makeTempDir("betterc0de-claude-plugin-on-")
    const disabledDir = makeTempDir("betterc0de-claude-plugin-off-")
    writePluginSkill(enabledDir, "keep", "---\nname: keep\n---\nx")
    writePluginSkill(disabledDir, "drop", "---\nname: drop\n---\nx")
    const configDir = makeConfigDir({
      plugins: {
        "keeper@mp": { installPath: enabledDir },
        "dropper@mp": { installPath: disabledDir },
      },
      enabledPlugins: { "dropper@mp": false },
    })

    const skills = await listClaudePluginSkills(configDir)
    expect(skills.map((skill) => skill.name)).toEqual(["keep"])
  })

  it("treats plugins without a settings entry as enabled", async () => {
    const pluginDir = makeTempDir("betterc0de-claude-plugin-")
    writePluginSkill(pluginDir, "solo", "---\nname: solo\n---\nx")
    const configDir = makeConfigDir({
      plugins: { "solo@mp": { installPath: pluginDir } },
    })
    const skills = await listClaudePluginSkills(configDir)
    expect(skills).toHaveLength(1)
  })

  it("returns [] when the registry is missing or unreadable", async () => {
    const configDir = makeTempDir("betterc0de-claude-config-empty-")
    expect(await listClaudePluginSkills(configDir)).toEqual([])
    fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true })
    fs.writeFileSync(
      path.join(configDir, "plugins", "installed_plugins.json"),
      "not json"
    )
    expect(await listClaudePluginSkills(configDir)).toEqual([])
  })

  it("ignores plugins whose install path vanished", async () => {
    const configDir = makeConfigDir({
      plugins: {
        "ghost@mp": {
          installPath: path.join(os.tmpdir(), "betterc0de-does-not-exist"),
        },
      },
    })
    expect(await listClaudePluginSkills(configDir)).toEqual([])
  })
})

describe("readClaudeSkill overrides", () => {
  it("applies scope/pluginId overrides for plugin-bundled skills", async () => {
    const root = makeTempDir("betterc0de-skillread-")
    const skillsDir = path.join(root, "skills")
    fs.mkdirSync(path.join(skillsDir, "pdf"), { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "pdf", "SKILL.md"),
      "---\nname: pdf\n---\nHandles PDFs."
    )
    const skill = await readClaudeSkill(skillsDir, "pdf", {
      scope: "plugin",
      pluginId: "docs@mp",
    })
    expect(skill).toMatchObject({
      name: "pdf",
      scope: "plugin",
      pluginId: "docs@mp",
      enabled: true,
    })
  })

  it("defaults to user scope without overrides", async () => {
    const root = makeTempDir("betterc0de-skillread-")
    const skillsDir = path.join(root, "skills")
    fs.mkdirSync(path.join(skillsDir, "x"), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, "x", "SKILL.md"), "body only")
    const skill = await readClaudeSkill(skillsDir, "x")
    expect(skill).toMatchObject({ name: "x", scope: "user" })
    expect(skill?.pluginId).toBeUndefined()
  })
})

describe("parseSkillMarkdownMetadata", () => {
  it("parses frontmatter keys tolerant of casing and quotes", () => {
    expect(
      parseSkillMarkdownMetadata(
        "---\nname: pdf\ndisplay-name: 'PDF Toolkit'\nshort_description: \"Short\"\n---\n"
      )
    ).toEqual({ name: "pdf", displayName: "PDF Toolkit", shortDescription: "Short" })
  })
})
