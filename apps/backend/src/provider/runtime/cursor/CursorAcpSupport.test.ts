import { describe, expect, it } from "vitest"
import {
  buildCursorAcpSpawnInput,
  resolveCursorAcpBaseModelId,
  resolveCursorAcpConfigUpdates,
  type CursorAcpSessionConfigOption,
} from "./CursorAcpSupport"

const parameterizedConfigOptions: ReadonlyArray<CursorAcpSessionConfigOption> =
  [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-5.4-medium-fast",
      options: [{ value: "gpt-5.4-medium-fast", name: "GPT-5.4" }],
    },
    {
      id: "reasoning",
      name: "Reasoning",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
        { value: "extra-high", name: "Extra High" },
      ],
    },
    {
      id: "context",
      name: "Context",
      category: "model_config",
      type: "select",
      currentValue: "272k",
      options: [
        { value: "272k", name: "272K" },
        { value: "1m", name: "1M" },
      ],
    },
    {
      id: "fast",
      name: "Fast",
      category: "model_config",
      type: "select",
      currentValue: "false",
      options: [
        { value: "false", name: "Off" },
        { value: "true", name: "Fast" },
      ],
    },
    {
      id: "thinking",
      name: "Thinking",
      category: "model_config",
      type: "boolean",
      currentValue: false,
    },
  ]

describe("buildCursorAcpSpawnInput", () => {
  it("refuses a missing or relative Cursor binary", () => {
    expect(() => buildCursorAcpSpawnInput(undefined, "/tmp/project")).toThrow(
      /absolute/
    )
    expect(() =>
      buildCursorAcpSpawnInput(
        { binaryPath: "cursor-agent" },
        "/tmp/project"
      )
    ).toThrow(/absolute/)
  })

  it("includes the configured api endpoint and binary path", () => {
    expect(
      buildCursorAcpSpawnInput(
        {
          binaryPath: "/usr/local/bin/agent",
          apiEndpoint: "http://localhost:3000",
        },
        "/tmp/project"
      )
    ).toEqual({
      command: "/usr/local/bin/agent",
      args: ["-e", "http://localhost:3000", "acp"],
      cwd: "/tmp/project",
    })
  })
})

describe("resolveCursorAcpBaseModelId", () => {
  it("strips parameterized model config suffixes", () => {
    expect(
      resolveCursorAcpBaseModelId(
        "gpt-5.4-medium-fast[reasoning=medium,context=272k]"
      )
    ).toBe("gpt-5.4-medium-fast")
  })

  it("falls back to default for empty values", () => {
    expect(resolveCursorAcpBaseModelId(" ")).toBe("default")
  })
})

describe("resolveCursorAcpConfigUpdates", () => {
  it("maps BetterC0de model selections to Cursor ACP config ids", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedConfigOptions, [
        { id: "reasoning", value: "xhigh" },
        { id: "contextWindow", value: "1m" },
        { id: "fastMode", value: true },
        { id: "thinking", value: true },
      ])
    ).toEqual([
      { configId: "reasoning", value: "extra-high" },
      { configId: "context", value: "1m" },
      { configId: "fast", value: "true" },
      { configId: "thinking", value: true },
    ])
  })

  it("accepts legacy effort option ids while preferring Cursor reasoning", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedConfigOptions, [
        { id: "effort", value: "high" },
      ])
    ).toEqual([{ configId: "reasoning", value: "high" }])
  })
})
