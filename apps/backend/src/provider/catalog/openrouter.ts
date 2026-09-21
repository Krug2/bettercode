import type { ProviderDefinition } from "./types";

export const openrouter: ProviderDefinition = {
  id: "openrouter",
  name: "OpenRouter",
  description: "Router across many providers — bring your own OR key.",
  // OpenRouter's full model catalog is fetched dynamically; the registry
  // only ships an empty list and the user adds favourites via
  // `custom_models`. Keep this empty to avoid stale defaults.
  defaultModels: [],
  enabledByDefault: true,
  docsUrl: "https://openrouter.ai/keys",
  authMethods: [
    {
      type: "api-key",
      label: "API Key",
      placeholder: "sk-or-...",
      envVars: ["OPENROUTER_API_KEY"],
    },
  ],
};
