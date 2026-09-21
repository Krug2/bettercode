import type { ProviderDefinition } from "./types";

export const anthropic: ProviderDefinition = {
  id: "anthropic",
  name: "Claude API",
  description: "Anthropic's Claude family — Fable, Opus, Sonnet, Haiku.",
  // Bare names resolve to the newest release via BARE_NAME_TO_LATEST.
  defaultModels: ["fable", "opus", "sonnet", "haiku"],
  enabledByDefault: true,
  docsUrl: "https://console.anthropic.com/settings/keys",
  authMethods: [
    {
      type: "api-key",
      label: "API Key",
      placeholder: "sk-ant-...",
      envVars: ["ANTHROPIC_API_KEY"],
      // Honour the user's existing `claude` CLI auth so an already-logged-in
      // CLI works in BetterC0de without re-pasting the key.
      cliConfig: [{ cli: "claude", field: "api_key" }],
    },
  ],
};
