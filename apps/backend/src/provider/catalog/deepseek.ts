import type { ProviderDefinition } from "./types";

export const deepseek: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  description: "DeepSeek-V3 / -R1 via DeepSeek's official API.",
  defaultModels: [],
  enabledByDefault: true,
  docsUrl: "https://platform.deepseek.com/api_keys",
  authMethods: [
    {
      type: "api-key",
      label: "API Key",
      placeholder: "sk-...",
      envVars: ["DEEPSEEK_API_KEY"],
    },
  ],
};
