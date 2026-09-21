import { assetUrl } from "@/lib/asset-url"
import type { UiProvider } from "@/lib/provider-types"

/**
 * Static list of built-in providers/models bundled with BetterC0de.
 *
 * Plugin providers (e.g. Claude CLI, third-party adapters) are merged in on
 * top of this list via the `useProviders` hook at runtime — this keeps the
 * plugin system decoupled from the core list while still letting the UI
 * show a single unified picker.
 *
 * Model tiers ("Flagship" / "Fast" / "Coding" / "Reasoning" / "Balanced" /
 * "Free") are labels only — they control how models group in the picker,
 * not which features the backend enables.
 */
export const builtinProviders: UiProvider[] = [
  {
    id: "codex",
    name: "Codex (CLI)",
    logo: assetUrl("icons/providers/openai.svg"),
    invertDark: true,
    providerKind: "codex",
    providerInstanceId: "codex",
    models: [
      // Keep model selection usable while the local metadata probe restarts.
      // Live `model/list` metadata still supplies model capabilities.
      // Only 5.5+ is listed — everything older was removed 2026-07-21 per
      // user request; older slugs still work when typed as custom models.
      // The reserved `__codex_cli_default__` selector was also dropped from
      // the picker — already-persisted selections still resolve (the backend
      // keeps translating it to "no explicit model").
      // Astra stays first even while live metadata is unavailable.
      {
        id: "gpt-6-astra",
        name: "GPT-6-Astra",
        context: "runtime",
        tier: "Flagship",
      },
      {
        id: "gpt-5.6-sol",
        name: "GPT 5.6 Sol",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "gpt-5.6-terra",
        name: "GPT 5.6 Terra",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "gpt-5.6-luna",
        name: "GPT 5.6 Luna",
        context: "1M",
        tier: "Flagship",
      },
      { id: "gpt-5.5", name: "GPT 5.5", context: "400K", tier: "Flagship" },
    ],
  },
  // Claude CLI — native backend builtin. Routes via /chat/send → ProviderHub
  // (chat.ts:38) → node-backend/src/provider/runtime/claude/ClaudeAdapter.ts.
  // Uses the Claude Agent SDK to spawn the local `claude` binary; falls back
  // to ANTHROPIC_API_KEY env if no CLI session credentials are configured.
  // No API key is required when the user is logged into `claude` via CLI.
  {
    id: "claude",
    name: "Claude CLI",
    logo: assetUrl("icons/providers/claude.svg"),
    providerKind: "claude",
    providerInstanceId: "claude",
    models: [
      {
        id: "claude-fable-5-1",
        name: "Fable 5.1",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "claude-fable-5",
        name: "Fable 5",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "claude-opus-5",
        name: "Opus 5",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "claude-opus-4-8",
        name: "Opus 4.8",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "claude-sonnet-5",
        name: "Sonnet 5",
        context: "1M",
        tier: "Balanced",
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Haiku 4.5",
        context: "200K",
        tier: "Fast",
      },
    ],
  },
  // Cursor Agent — BetterC0de treats Cursor as a first-party provider driver.
  // Models are discovered through ACP at runtime, so the built-in fallback
  // intentionally starts empty and can be filled by provider-instance metadata.
  {
    id: "cursor",
    name: "Cursor",
    logo: "",
    providerKind: "cursor",
    providerInstanceId: "cursor",
    models: [],
  },
  // Grok CLI — xAI's local `grok` binary (Grok Build) driven over ACP
  // (`grok agent stdio`). providerKind "grok_cli" is distinct from the
  // "grok" xAI API-key provider below. Curated fallback models; live models
  // merge in from the runtime instance metadata when the CLI advertises a
  // model picker.
  {
    id: "grok-cli",
    name: "Grok CLI",
    // Grok's own mark — not the X/Twitter logo and not xAI's company slash.
    // Black-on-transparent plus `invertDark`, because `ProviderIcon` renders
    // logos through an `<img>`: an SVG loaded that way is an isolated
    // document, so a `currentColor` fill cannot inherit the page's text
    // colour and would resolve to black on a dark background.
    logo: assetUrl("icons/providers/grok.svg"),
    invertDark: true,
    providerKind: "grok_cli",
    providerInstanceId: "grok-cli",
    // This curated list wins the merge in `use-providers`, so a stale entry
    // here outranks whatever the CLI actually offers. Grok's real inventory
    // comes from `~/.grok/models_cache.json` (see `GrokModelCache`); keep this
    // to the current flagships only.
    models: [
      { id: "grok-4.6", name: "Grok 4.6", context: "500K", tier: "Flagship" },
      { id: "grok-4.5", name: "Grok 4.5", context: "500K", tier: "Flagship" },
    ],
  },
  // BetterC0de compatibility inventory is discovered from runtime snapshots
  // or custom models, so the static list stays empty.
  {
    id: "betterc0de",
    name: "BetterC0de",
    logo: "",
    providerKind: "betterc0de",
    providerInstanceId: "betterc0de",
    models: [],
  },
  // OpenAI API (direct API key)
  {
    id: "openai-api",
    name: "OpenAI API",
    logo: assetUrl("icons/providers/openai.svg"),
    invertDark: true,
    providerKind: "openai",
    openaiTransport: "api",
    models: [
      { id: "gpt-5.4", name: "GPT 5.4", context: "256K", tier: "Flagship" },
      {
        id: "gpt-5.4-mini",
        name: "GPT 5.4 Mini",
        context: "256K",
        tier: "Fast",
      },
      { id: "gpt-5.3-codex", name: "Codex 5.3", context: "1M", tier: "Coding" },
      {
        id: "gpt-5.3-codex-spark",
        name: "Codex 5.3 Spark",
        context: "512K",
        tier: "Coding",
      },
      {
        id: "gpt-5.2-codex",
        name: "Codex 5.2",
        context: "256K",
        tier: "Coding",
      },
      { id: "gpt-5.2", name: "GPT 5.2", context: "256K", tier: "Balanced" },
      { id: "o4-mini", name: "o4 Mini", context: "200K", tier: "Reasoning" },
    ],
  },
  // Google oAuth (Gemini) was removed from the builtin picker 2026-07-21 per
  // user request. The generic "google" providerKind heuristics elsewhere
  // (thinking-mode, capabilities, labels) stay — plugin/API instances may
  // still use them.
  // Grok (xAI API)
  {
    id: "grok",
    name: "Grok",
    logo: assetUrl("icons/providers/grok.svg"),
    invertDark: true,
    // Mirrors xAI's own model metadata (~/.grok/models_cache.json): both
    // flagships are `supported_in_api: true` with 500K context, and the
    // backend passes the reasoning selection through as `reasoning_effort`.
    models: [
      { id: "grok-4.6", name: "Grok 4.6", context: "500K", tier: "Flagship" },
      { id: "grok-4.5", name: "Grok 4.5", context: "500K", tier: "Flagship" },
    ],
  },
  // OpenRouter — its own picker entry: shows exactly the model ids the user
  // entered under Settings → Providers → OpenRouter → Custom models (merged
  // in by useProvidersWithLmStudio; empty until the user adds some).
  {
    id: "openrouter",
    name: "OpenRouter",
    logo: assetUrl("icons/providers/openrouter.svg"),
    // The svg paints with `currentColor`, which resolves to black inside the
    // <img> ProviderIcon uses — invert it on dark like the Grok mark.
    invertDark: true,
    providerKind: "openrouter",
    models: [],
  },
  // OpenRouter family groups — models split by actual vendor (all use
  // providerKind "openrouter" for backend). The static entries below are the
  // curated fallback; when an OpenRouter key is configured the backend's
  // cached live catalog replaces them (see useProvidersWithLmStudio). When a
  // fallback id 404s, re-check https://openrouter.ai/api/v1/models instead
  // of guessing a replacement.
  // Qwen (via OpenRouter)
  {
    id: "or-qwen",
    name: "Qwen",
    logo: assetUrl("icons/providers/qwen.png"),
    providerKind: "openrouter",
    models: [
      {
        id: "qwen/qwen3.8-max",
        name: "Qwen 3.8 Max",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "qwen/qwen3.8-27b",
        name: "Qwen 3.8 27B",
        context: "1M",
        tier: "Balanced",
      },
      {
        id: "qwen/qwen3.8-flash",
        name: "Qwen 3.8 Flash",
        context: "1M",
        tier: "Fast",
      },
      {
        id: "qwen/qwen3-coder-next",
        name: "Qwen 3 Coder Next",
        context: "256K",
        tier: "Coding",
      },
    ],
  },
  // DeepSeek (via OpenRouter)
  {
    id: "or-deepseek",
    name: "DeepSeek",
    logo: assetUrl("icons/providers/deepseek.png"),
    providerKind: "openrouter",
    models: [
      {
        id: "deepseek/deepseek-v4-pro-0813",
        name: "DeepSeek V4 Pro",
        context: "1M",
        tier: "Flagship",
      },
      {
        id: "deepseek/deepseek-v4-flash-0731",
        name: "DeepSeek V4 Flash",
        context: "1.3M",
        tier: "Fast",
      },
      {
        id: "deepseek/deepseek-v3.2",
        name: "DeepSeek V3.2",
        context: "160K",
        tier: "Balanced",
      },
    ],
  },
  // LM Studio (local)
  {
    id: "lmstudio",
    name: "LM Studio",
    logo: assetUrl("icons/providers/lmstudio.png"),
    models: [] as {
      id: string
      name: string
      context: string
      tier: string
    }[],
  },
]
