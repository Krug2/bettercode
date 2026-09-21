import type { ProviderDefinition } from "./types";

/**
 * LM Studio runs a local OpenAI-compatible server. No API key is needed by
 * default; the user can override the base URL if they run on a non-default
 * port. Modelled as a `local-server` auth method so the UI knows to render
 * a base-URL field instead of a key field.
 */
export const lmstudio: ProviderDefinition = {
  id: "lmstudio",
  name: "LM Studio",
  description: "Local model server (OpenAI-compatible). No key required.",
  defaultModels: [],
  enabledByDefault: true,
  docsUrl: "https://lmstudio.ai/docs/local-server",
  authMethods: [
    {
      type: "local-server",
      label: "Server URL",
      defaultBaseUrl: "http://localhost:1234",
      hint: "Override only if LM Studio is running on a non-default host/port.",
    },
  ],
};
