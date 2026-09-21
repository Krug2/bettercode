/**
 * The SDK (`@anthropic-ai/claude-agent-sdk`) isn't in node-backend's
 * tsconfig — it lives in the repo-root node_modules. These shapes capture
 * only the surface we actually call, so the backend type-checks even when
 * the SDK isn't installed from its own package.json.
 */

export interface SdkQuery {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  interrupt?: () => Promise<void> | void;
  close?: () => Promise<void> | void;
}

export interface SdkModule {
  query(args: {
    prompt: string;
    options?: {
      model?: string;
      cwd?: string;
      maxTurns?: number;
      tools?: string[];
      /** Named reasoning effort supported by the SDK (low/medium/high/max). */
      effort?: string;
      /** Emit `stream_event` frames for incremental thinking/text deltas. */
      includePartialMessages?: boolean;
      /**
       * Absolute path to the platform-specific `claude{.exe}` binary. The
       * shell process resolves this against `app.asar.unpacked/...` so the
       * OS can actually exec it; the SDK's own resolver returns a path
       * inside `app.asar` which `child_process.spawn` cannot launch.
       */
      pathToClaudeCodeExecutable?: string;
      canUseTool?: (
        toolName: string,
        toolInput: unknown,
      ) => Promise<{ behavior: "allow" | "deny"; input?: unknown; reason?: string }>;
      hooks?: Record<
        string,
        Array<{
          hooks: Array<() => Promise<unknown>>;
        }>
      >;
    };
  }): SdkQuery;
}

// UI → SDK effort level mapping. The installed SDK accepts low/medium/high/max.
// Claude xHigh / Extra High maps to Claude's native Max effort, matching the
// runtime adapter and BetterC0de's Opus 4.7 normalization.
export const UI_TO_EFFORT: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
  ultrathink: "max",
  "ultra think": "max",
};

/**
 * Map the UI's reasoning-effort string to the SDK `effort` option.
 *
 * The Claude Agent SDK chooses thinking strategy + budget internally based on
 * the `effort` value and the active model. Passing an explicit
 * `thinking: { type: "adaptive" | "enabled" }` here opts the SDK out of its
 * streaming-friendly default path (no `thinking_delta` frames in
 * `stream_event` notifications), which kills live reasoning streaming.
 *
 * Mirrors BetterC0de's working pipeline: only `effort` ever crosses this
 * boundary; the SDK does the rest.
 */
export function getThinkingOptions(
  effort: string | null | undefined,
  _modelId: string,
): { effort?: string } {
  if (!effort) return {};
  const key = effort.toLowerCase();
  const mapped = Object.hasOwn(UI_TO_EFFORT, key) ? UI_TO_EFFORT[key] : undefined;
  return mapped ? { effort: mapped } : {};
}
