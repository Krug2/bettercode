import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_GIT_TEXT_GENERATION_MODEL, settingsSchema } from "@betterc0de/schema"
import {
  extractGeneratedTitleText,
  resolveThreadContextCompactionModelSelection,
  resolveThreadContextCompactionModelSelections,
  resolveTextGenerationModelSelectionForTurn,
  resolveTextGenerationModelSelection,
  sanitizeGeneratedTitle,
} from "./chat"

describe("chat title helpers", () => {
  it("extracts BetterC0de JSON title responses", () => {
    expect(
      extractGeneratedTitleText('{"title":"Fix provider runtime permissions"}')
    ).toBe("Fix provider runtime permissions")
  })

  it("extracts fenced JSON title responses", () => {
    expect(
      extractGeneratedTitleText(
        '```json\n{"title":"Review BetterC0de compatibility adapter parity"}\n```'
      )
    ).toBe("Review BetterC0de compatibility adapter parity")
  })

  it("keeps legacy raw-title responses working", () => {
    expect(extractGeneratedTitleText("Plan mode UI polish\nextra")).toBe(
      "Plan mode UI polish"
    )
  })

  it("sanitizes generated titles for sidebar display", () => {
    expect(
      sanitizeGeneratedTitle('  "`Investigate reconnect regressions.`"  ')
    ).toBe("Investigate reconnect regressions")
    expect(
      sanitizeGeneratedTitle(
        "Investigate websocket reconnect regressions after provider resume with a long trailing clause"
      )
    ).toBe("Investigate websocket reconnect regressions aft...")
    expect(sanitizeGeneratedTitle('  """   """  ')).toBe("New thread")
  })
})

describe("thread-context compaction model selection", () => {
  it("uses only Codex or Claude native providers for Claude Terminal handoff", () => {
    const settings = settingsSchema.parse({
      textGenerationModelSelection: {
        instanceId: "betterc0de",
        model: "openai/gpt-5",
      },
    })

    expect(resolveThreadContextCompactionModelSelection(settings)).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
    })
  })

  it("maps an explicit Claude Terminal handoff to the direct Claude compacter", () => {
    const settings = settingsSchema.parse({
      providers: {
        claude: { enabled: true },
      },
    })

    expect(
      resolveThreadContextCompactionModelSelection(settings, {
        instanceId: "claude-terminal",
        model: "gpt-5.5",
        options: [{ id: "effort", value: "max" }],
      })
    ).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
      options: [{ id: "effort", value: "max" }],
    })
  })

  it("maps an explicit Claude Terminal handoff to Codex when direct Claude is unavailable", () => {
    const settings = settingsSchema.parse({
      providers: {
        claude: { enabled: false },
      },
      provider_instances: {
        "claude-terminal": {
          driver: "claude-terminal",
          enabled: true,
        },
      },
    })

    expect(
      resolveThreadContextCompactionModelSelection(settings, {
        instanceId: "claude-terminal",
        model: "claude-opus-4-7",
        options: [
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      })
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
      options: [
        { id: "reasoningEffort", value: "xhigh" },
        { id: "fastMode", value: true },
      ],
    })
  })

  it("falls back to Claude when Codex is disabled", () => {
    const settings = settingsSchema.parse({
      providers: {
        codex: { enabled: false },
        claude: { enabled: true },
      },
    })

    expect(resolveThreadContextCompactionModelSelection(settings)).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
    })
  })

  it("keeps additional native candidates for retrying failed compactors", () => {
    const settings = settingsSchema.parse({
      providers: {
        claude: { enabled: true },
      },
    })
    const candidates = resolveThreadContextCompactionModelSelections(settings, {
      instanceId: "claude-terminal",
      model: "claude-opus-4-7",
      options: [{ id: "effort", value: "max" }],
    })

    expect(candidates[0]).toEqual({
      instanceId: "claude",
      model: "claude-opus-4-7",
      options: [{ id: "effort", value: "max" }],
    })
    expect(candidates).toEqual(
      expect.arrayContaining([
        { instanceId: "codex", model: "gpt-5.4-mini" },
        { instanceId: "claude", model: "claude-haiku-4-5" },
      ])
    )
    expect(candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "claude-terminal" }),
      ])
    )
  })
})

describe("text-generation model selection", () => {
  it("uses a string fallback for an unknown driver named constructor", () => {
    const settings = settingsSchema.parse({
      provider_instances: { codex: { driver: "constructor", enabled: true } },
      textGenerationModelSelection: { instanceId: "missing", model: "unused" },
    })
    expect(resolveTextGenerationModelSelection(settings)).toEqual({
      instanceId: "codex", model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
    })
  })

  it("uses the persisted provider selection when it points to an enabled provider", () => {
    const settings = settingsSchema.parse({
      textGenerationModelSelection: {
        instanceId: "claude",
        model: "claude-haiku-4-5",
        options: { thinking: "max" },
      },
    })

    expect(resolveTextGenerationModelSelection(settings)).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
      options: [{ id: "thinking", value: "max" }],
    })
  })

  it("falls back to the first enabled provider and provider-specific git model", () => {
    const settings = settingsSchema.parse({
      providers: {
        codex: { enabled: false },
        claude: { enabled: true },
      },
      textGenerationModelSelection: {
        instanceId: "codex",
        model: "gpt-5.4-mini",
      },
    })

    expect(resolveTextGenerationModelSelection(settings)).toEqual({
      instanceId: "claude",
      model: "claude-haiku-4-5",
    })
  })

  it("keeps explicit request selections even when settings prefer another provider", () => {
    const settings = settingsSchema.parse({
      textGenerationModelSelection: {
        instanceId: "claude",
        model: "claude-haiku-4-5",
      },
    })

    expect(
      resolveTextGenerationModelSelection(settings, {
        instanceId: "betterc0de",
        model: "openai/gpt-5",
      })
    ).toEqual({
      instanceId: "betterc0de",
      model: "openai/gpt-5",
    })
  })

  it("uses BetterC0de project small_model for text-generation tasks when BetterC0de compatibility is enabled", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-betterc0de-small-model-")
    )
    await fs.writeFile(
      path.join(root, "betterc0de.jsonc"),
      '{ "small_model": "anthropic/claude-haiku-4-5" }',
      "utf8"
    )
    try {
      const settings = settingsSchema.parse({
        providers: {
          betterc0de: { enabled: true },
        },
      })

      await expect(
        resolveTextGenerationModelSelectionForTurn(settings, root)
      ).resolves.toEqual({
        instanceId: "betterc0de",
        model: "anthropic/claude-haiku-4-5",
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("falls back to stored settings when project small_model cannot run through BetterC0de", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "betterc0de-betterc0de-small-model-")
    )
    await fs.writeFile(
      path.join(root, "betterc0de.jsonc"),
      '{ "small_model": "anthropic/claude-haiku-4-5" }',
      "utf8"
    )
    try {
      const settings = settingsSchema.parse({
        providers: {
          betterc0de: { enabled: false },
        },
      })

      await expect(
        resolveTextGenerationModelSelectionForTurn(settings, root)
      ).resolves.toEqual({
        instanceId: "codex",
        model: "gpt-5.4-mini",
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
