import { describe, expect, it } from "vitest"
import {
  formatProviderSkillCommandDescription,
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
} from "@/lib/provider-skill-presentation"

describe("formatProviderSkillDisplayName", () => {
  it("prefers the provider display name", () => {
    expect(
      formatProviderSkillDisplayName({
        name: "review-follow-up",
        displayName: "Review Follow-up",
      }),
    ).toBe("Review Follow-up")
  })

  it("falls back to a title-cased skill name", () => {
    expect(
      formatProviderSkillDisplayName({
        name: "review-follow-up",
      }),
    ).toBe("Review Follow Up")
  })
})

describe("formatProviderSkillInstallSource", () => {
  it("labels skills bundled in a CLI plugin with the plugin name", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "C:\\Users\\x\\.claude\\plugins\\cache\\mp\\frontend-design\\1\\skills\\web\\SKILL.md",
        scope: "plugin",
        pluginId: "frontend-design@claude-plugins-official",
      }),
    ).toBe("Plugin: frontend-design")
  })

  it("labels Claude plugin cache paths without pluginId as app installs", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/home/x/.claude/plugins/cache/mp/figma/2.2.76/skills/y/SKILL.md",
        scope: undefined,
      }),
    ).toBe("App")
  })

  it("marks plugin-backed skills as app installs", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/Users/developer/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("App")
    expect(
      formatProviderSkillInstallSource({
        path: "C:\\Users\\developer\\.agents\\plugins\\cache\\tools\\skills\\review\\SKILL.md",
        scope: "personal",
      }),
    ).toBe("App")
  })

  it("maps standard scopes to user-facing labels", () => {
    expect(
      formatProviderSkillInstallSource({
        path: "/Users/developer/.agents/skills/agent-browser/SKILL.md",
        scope: "user",
      }),
    ).toBe("Personal")
    expect(
      formatProviderSkillInstallSource({
        path: "/usr/local/share/codex/skills/imagegen/SKILL.md",
        scope: "system",
      }),
    ).toBe("System")
    expect(
      formatProviderSkillInstallSource({
        path: "/workspace/.codex/skills/review-follow-up/SKILL.md",
        scope: "project",
      }),
    ).toBe("Project")
  })
})

describe("formatProviderSkillCommandDescription", () => {
  it("combines display name, description and source for the skill menu", () => {
    expect(
      formatProviderSkillCommandDescription({
        name: "gh-fix-ci",
        displayName: "Fix CI",
        shortDescription: "Inspect failing checks",
        path: "/Users/developer/.codex/plugins/cache/openai-curated/github/skills/gh-fix-ci/SKILL.md",
        scope: "user",
      }),
    ).toBe("Fix CI - Inspect failing checks - App")
  })
})
