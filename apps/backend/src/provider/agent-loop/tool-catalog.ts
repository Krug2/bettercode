/**
 * Tool catalog for the in-house agent loop (direct-API providers).
 *
 * These are the tools BetterC0de itself executes (see `tool-executor.ts`) when
 * driving the OpenAI-compatible / Claude-API adapters — as opposed to the CLI
 * harnesses (Claude SDK, Codex, Cursor) which ship their own tools.
 *
 * Tool NAMES are intentionally identical to the canonical names in
 * `shared/chat-mode-tools.ts` so the per-mode allowlist (`getToolsForMode`) and
 * the permission gate (`classifyTool` / `buildCanUseTool`) line up without
 * translation. We only declare the subset we can actually execute; anything in
 * the mode allowlist that isn't in `EXECUTABLE_TOOLS` is simply not advertised
 * to the model.
 */

import { isRecord } from "@betterc0de/schema";

export interface ToolDef {
  name: string;
  description: string;
  permissionDomain: "read" | "write" | "execute";
  /** JSON Schema for the tool input (an `object` schema). */
  parameters: Record<string, unknown>;
}

/** Shared upper bound for every BetterC0de-owned direct tool invocation. */
export const DIRECT_TOOL_TIMEOUT_MS = 60_000;

const READ: ToolDef = {
  name: "Read",
  description:
    "Read the full contents of a text file in the project. Use this before editing a file.",
  permissionDomain: "read",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const WRITE: ToolDef = {
  name: "Write",
  description:
    "Create a new file or overwrite an existing file with the given contents. Parent directories are created automatically.",
  permissionDomain: "write",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root.",
      },
      content: { type: "string", description: "Full file contents to write." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

const EDIT: ToolDef = {
  name: "Edit",
  description:
    "Replace an exact string in a file. `old_string` must match the file exactly and be unique unless `replace_all` is true. Read the file first to get exact text.",
  permissionDomain: "write",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root.",
      },
      old_string: {
        type: "string",
        description: "The exact text to replace (must be unique in the file).",
      },
      new_string: {
        type: "string",
        description: "The text to replace it with.",
      },
      replace_all: {
        type: "boolean",
        description: "Replace every occurrence instead of requiring uniqueness.",
      },
    },
    required: ["path", "old_string", "new_string"],
    additionalProperties: false,
  },
};

const BASH: ToolDef = {
  name: "Bash",
  description:
    "Run a shell command in the project directory and return its combined stdout/stderr and exit code. Use for builds, tests, git, and inspecting the system.",
  permissionDomain: "execute",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      timeout_ms: {
        type: "number",
        minimum: 1,
        maximum: DIRECT_TOOL_TIMEOUT_MS,
        description: "Optional timeout in milliseconds (maximum 60000).",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

const GLOB: ToolDef = {
  name: "Glob",
  description:
    "Find files whose name or path contains the given substring (case-insensitive). Returns a list of matching paths. Use to locate files when you don't know the exact path.",
  permissionDomain: "read",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Substring to match against file names/paths.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

const GREP: ToolDef = {
  name: "Grep",
  description:
    "Search file contents across the project for a string or regular expression. Returns matching file paths with line numbers and previews.",
  permissionDomain: "read",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Text or regular expression to search for.",
      },
      regex: {
        type: "boolean",
        description: "Treat `pattern` as a regular expression.",
      },
      case_sensitive: { type: "boolean", description: "Case-sensitive match." },
      include: {
        type: "string",
        description: "Optional glob to restrict which files are searched.",
      },
      exclude: {
        type: "string",
        description: "Optional glob of files to skip.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

/** Every tool the in-house loop can execute, keyed by canonical name. */
export const TOOL_DEFS: Record<string, ToolDef> = {
  Read: READ,
  Write: WRITE,
  Edit: EDIT,
  Bash: BASH,
  Glob: GLOB,
  Grep: GREP,
};

/** Names the loop can actually execute (intersect with the mode allowlist). */
export const EXECUTABLE_TOOLS: ReadonlySet<string> = new Set(
  Object.keys(TOOL_DEFS),
);

export type ToolInputValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validate the JSON-Schema subset used by the canonical registry before a
 * provider-controlled payload reaches an executor. This deliberately supports
 * only the closed object/primitive subset declared above; extending a tool
 * schema without extending this validator fails closed.
 */
export function validateToolInput(
  toolName: string,
  input: unknown,
): ToolInputValidation {
  const definition = Object.hasOwn(TOOL_DEFS, toolName) ? TOOL_DEFS[toolName] : undefined;
  if (!definition) {
    return { ok: false, error: `Unknown tool "${toolName}".` };
  }
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return {
      ok: false,
      error: `${toolName} input must be a JSON object.`,
    };
  }

  const value = input as Record<string, unknown>;
  const schema = definition.parameters as {
    type?: unknown;
    properties?: unknown;
    required?: unknown;
    additionalProperties?: unknown;
  };
  if (schema.type !== "object" || !isRecord(schema.properties)) {
    return {
      ok: false,
      error: `${toolName} has an unsupported input schema.`,
    };
  }
  const properties = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  const issues: string[] = [];

  for (const key of required) {
    if (!Object.hasOwn(value, key)) issues.push(`missing "${key}"`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) issues.push(`unexpected "${key}"`);
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key) || !isRecord(propertySchema)) continue;
    const propertyValue = value[key];
    const expectedType = propertySchema.type;
    const validType =
      (expectedType === "string" && typeof propertyValue === "string") ||
      (expectedType === "boolean" && typeof propertyValue === "boolean") ||
      (expectedType === "number" &&
        typeof propertyValue === "number" &&
        Number.isFinite(propertyValue));
    if (!validType) {
      issues.push(`"${key}" must be ${String(expectedType)}`);
      continue;
    }
    if (typeof propertyValue === "number") {
      if (
        typeof propertySchema.minimum === "number" &&
        propertyValue < propertySchema.minimum
      ) {
        issues.push(`"${key}" is below its minimum`);
      }
      if (
        typeof propertySchema.maximum === "number" &&
        propertyValue > propertySchema.maximum
      ) {
        issues.push(`"${key}" exceeds its maximum`);
      }
    }
  }

  return issues.length > 0
    ? {
        ok: false,
        error: `${toolName} input is invalid: ${issues.slice(0, 3).join(", ")}.`,
      }
    : { ok: true, value };
}

export function toolPermissionDomain(
  toolName: string,
): ToolDef["permissionDomain"] | null {
  return Object.hasOwn(TOOL_DEFS, toolName) ? TOOL_DEFS[toolName]?.permissionDomain ?? null : null;
}

/** Filter an allowlist down to the tools we can execute, preserving order. */
export function executableToolDefs(allowed: readonly string[]): ToolDef[] {
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const name of allowed) {
    if (seen.has(name)) continue;
    const def = Object.hasOwn(TOOL_DEFS, name) ? TOOL_DEFS[name] : undefined;
    if (def) {
      seen.add(name);
      out.push(def);
    }
  }
  return out;
}

/** OpenAI Chat Completions `tools` array for the given allowlist. */
export function toOpenAiTools(allowed: readonly string[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return executableToolDefs(allowed).map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));
}

/** Anthropic Messages `tools` array for the given allowlist. */
export function toAnthropicTools(allowed: readonly string[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return executableToolDefs(allowed).map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
  }));
}
