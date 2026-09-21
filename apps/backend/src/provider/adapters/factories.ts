import { OpenAiCompatAdapter } from "./openaiCompat";
import type { ProviderAdapter } from "../adapter";
import type { ModelDefinition } from "../types";
import { LM_STUDIO_BASE_URL } from "../../constants";
import type { DirectMcpAdapterOptions } from "../agent-loop/direct-mcp-tools";

export function makeOpenAiAdapter(
  apiKey: string | null,
  agentTools: DirectMcpAdapterOptions = {},
): ProviderAdapter {
  const defaultModels: ModelDefinition[] = [
    { slug: "gpt-4o", name: "GPT-4o", provider: "openai" },
    { slug: "gpt-4o-mini", name: "GPT-4o mini", provider: "openai" },
    { slug: "o1", name: "o1", provider: "openai" },
    { slug: "o3-mini", name: "o3-mini", provider: "openai" },
  ];
  return new OpenAiCompatAdapter({
    providerKind: "openai",
    displayName: "OpenAI",
    defaultModels,
  }, apiKey, agentTools);
}

export function makeGrokAdapter(
  apiKey: string | null,
  agentTools: DirectMcpAdapterOptions = {},
): ProviderAdapter {
  return new OpenAiCompatAdapter({
    providerKind: "grok",
    displayName: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    defaultModels: [
      { slug: "grok-4.6", name: "Grok 4.6", provider: "grok" },
      { slug: "grok-4.5", name: "Grok 4.5", provider: "grok" },
    ],
  }, apiKey, agentTools);
}

export function makeOpenRouterAdapter(
  apiKey: string | null,
  agentTools: DirectMcpAdapterOptions = {},
): ProviderAdapter {
  return new OpenAiCompatAdapter({
    providerKind: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModels: [], // OpenRouter model list is fetched dynamically elsewhere.
  }, apiKey, agentTools);
}

export function makeLmStudioAdapter(
  agentTools: DirectMcpAdapterOptions = {},
): ProviderAdapter {
  return new OpenAiCompatAdapter({
    providerKind: "lmstudio",
    displayName: "LM Studio (local)",
    baseUrl: LM_STUDIO_BASE_URL,
    defaultModels: [], // Resolved at runtime via /v1/models.
  }, null, agentTools); // OpenAiCompatAdapter handles the no-key case for lmstudio.
}
