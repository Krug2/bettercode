import type { ModelDefinition } from "../../types";

export function claudeAgentModels(): ModelDefinition[] {
  return [
    { slug: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "anthropic_cli" },
    { slug: "claude-fable-5", name: "Claude Fable 5", provider: "anthropic_cli" },
    { slug: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic_cli" },
    { slug: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic_cli" },
    { slug: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "anthropic_cli" },
    { slug: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic_cli" },
  ];
}
