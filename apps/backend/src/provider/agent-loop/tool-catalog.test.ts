import { describe, it, expect } from "vitest";
import {
  EXECUTABLE_TOOLS,
  executableToolDefs,
  toolPermissionDomain,
  toOpenAiTools,
  toAnthropicTools,
  validateToolInput,
} from "./tool-catalog";
import { AGENT_TOOLS, PLAN_TOOLS } from "../shared/chat-mode-tools";

describe("tool-catalog", () => {
  it("every executable tool name exists in the agent allowlist", () => {
    for (const name of EXECUTABLE_TOOLS) {
      expect(AGENT_TOOLS).toContain(name);
    }
  });

  it("executableToolDefs intersects the allowlist and dedupes, preserving order", () => {
    const defs = executableToolDefs(["Read", "Read", "WebSearch", "Bash"]);
    expect(defs.map((d) => d.name)).toEqual(["Read", "Bash"]);
  });

  it("plan-mode tools resolve to the read-only executables", () => {
    const defs = executableToolDefs(PLAN_TOOLS);
    expect(defs.map((d) => d.name)).toEqual(["Read", "Glob", "Grep"]);
  });

  it("toOpenAiTools produces the Chat Completions shape", () => {
    const tools = toOpenAiTools(["Read"]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ type: "function", function: { name: "Read" } });
    expect(tools[0].function.parameters).toHaveProperty("type", "object");
  });

  it("toAnthropicTools produces the Messages shape", () => {
    const tools = toAnthropicTools(["Bash"]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "Bash" });
    expect(tools[0].input_schema).toHaveProperty("type", "object");
  });

  it("drops non-executable names (e.g. WebSearch) from the advertised set", () => {
    expect(toOpenAiTools(["WebSearch", "AskUserQuestion"])).toHaveLength(0);
  });

  it.each(["constructor", "__proto__", "toString"])("rejects inherited tool name %s", (name) => {
    expect(validateToolInput(name, {})).toMatchObject({ ok: false, error: `Unknown tool "${name}".` });
    expect(executableToolDefs([name])).toEqual([]);
    expect(toolPermissionDomain(name)).toBeNull();
  });

  it("requires own input fields and rejects prototype-named extra fields", () => {
    expect(validateToolInput("Read", Object.create({ path: "secret" }))).toMatchObject({ ok: false });
    expect(validateToolInput("Read", JSON.parse('{"path":"a.txt","__proto__":{}}'))).toMatchObject({ ok: false });
    expect(validateToolInput("Read", { path: "a.txt", constructor: "extra" })).toMatchObject({ ok: false });
  });

  it("validates the exact registered object schema before dispatch", () => {
    expect(validateToolInput("Read", { path: "src/a.ts" })).toEqual({
      ok: true,
      value: { path: "src/a.ts" },
    });
    expect(validateToolInput("Read", null)).toMatchObject({
      ok: false,
      error: expect.stringContaining("JSON object"),
    });
    expect(
      validateToolInput("Bash", {
        command: "npm test",
        timeout_ms: 60_001,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("maximum"),
    });
    expect(
      validateToolInput("Write", {
        path: "a.txt",
        content: "value",
        surprise: true,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('unexpected "surprise"'),
    });
  });

  it("keeps permission domains in the same canonical descriptor", () => {
    expect(toolPermissionDomain("Read")).toBe("read");
    expect(toolPermissionDomain("Edit")).toBe("write");
    expect(toolPermissionDomain("Bash")).toBe("execute");
    expect(toolPermissionDomain("Unknown")).toBeNull();
  });
});
