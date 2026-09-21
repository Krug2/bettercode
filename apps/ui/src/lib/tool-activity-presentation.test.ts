import { describe, expect, it } from "vitest"
import {
  deriveProviderToolActivityPresentation,
  describeProviderToolActivity,
  extractToolOutputText,
  normalizeProviderToolCommandValue,
} from "@betterc0de/schema/tool-activity"

describe("normalizeProviderToolCommandValue", () => {
  it("keeps script quotes verbatim when the provider supplies argv", () => {
    const script = 'Write-Output "hello world"; $value = "C:\\work"'
    expect(normalizeProviderToolCommandValue(["pwsh", "-NoProfile", "-Command", script])).toBe(script)
  })

  it("finds the script after options with their own values", () => {
    expect(normalizeProviderToolCommandValue('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -ExecutionPolicy Bypass -Command "Get-ChildItem"')).toBe("Get-ChildItem")
    expect(normalizeProviderToolCommandValue(["bash", "-o", "pipefail", "-c", "npm test"])).toBe("npm test")
  })

  it("retains argument boundaries when more arguments follow the command switch", () => {
    expect(normalizeProviderToolCommandValue(["pwsh", "-Command", "Get-Item", "C:\\My Folder"])).toBe('Get-Item "C:\\My Folder"')
    expect(normalizeProviderToolCommandValue(["bash", "-c", "echo $0", "task name"])).toBe('"echo $0" "task name"')
  })

  it.each([
    'pwsh -WorkingDirectory "a -Command b" -File task.ps1',
    'pwsh -File task.ps1 -Command literal',
    'bash script.sh -c literal',
    'cmd /k echo /c literal',
    'bash -- -c literal',
    'bash -c',
    '"unfinished executable -c echo ok',
  ])("leaves ambiguous or non-script invocations intact: %s", command => {
    expect(normalizeProviderToolCommandValue(command)).toBe(command)
  })

  it("preserves separately quoted expressions and incomplete streamed scripts", () => {
    expect(normalizeProviderToolCommandValue('pwsh -Command "hello" + "world"')).toBe('"hello" + "world"')
    expect(normalizeProviderToolCommandValue('bash -c "echo unfinished')).toBe('"echo unfinished')
  })

  it("ignores absent and malformed command values", () => {
    for (const value of [undefined, null, {}, [], [null, 1, " "], " "]) {
      expect(normalizeProviderToolCommandValue(value)).toBeUndefined()
    }
  })

  it("unwraps POSIX shell command wrappers", () => {
    expect(normalizeProviderToolCommandValue(["bash", "-lc", "npm test"])).toBe(
      "npm test"
    )
    expect(
      normalizeProviderToolCommandValue('/bin/zsh -lc "npm run typecheck"')
    ).toBe("npm run typecheck")
  })

  it("unwraps Windows shell command wrappers", () => {
    expect(
      normalizeProviderToolCommandValue(["pwsh.exe", "-Command", "npm test"])
    ).toBe("npm test")
    expect(
      normalizeProviderToolCommandValue(["cmd.exe", "/c", "npm test"])
    ).toBe("npm test")
  })

  it("keeps non-wrapper command arrays readable", () => {
    expect(
      normalizeProviderToolCommandValue(["git", "commit", "-m", "hello world"])
    ).toBe('git commit -m "hello world"')
  })
})

describe("deriveProviderToolActivityPresentation", () => {
  it("chooses the first valid path in provider priority order, including nested locations", () => {
    expect(deriveProviderToolActivityPresentation({
      title: "Read File",
      data: { path: "not-a-path", locations: [{ file_path: "src/first.ts" }], input: { path: "src/later.ts" } },
    })).toEqual({ summary: "Read file", detail: "src/first.ts" })
  })

  it("bounds cyclic location data and still reaches a usable fallback", () => {
    const locations: Record<string, unknown> = {}
    locations.locations = locations
    expect(deriveProviderToolActivityPresentation({
      title: "Read File", data: { locations, input: { path: "src/fallback.ts" } },
    })).toEqual({ summary: "Read file", detail: "src/fallback.ts" })
  })

  it("does not enumerate unused locations after finding the primary path", () => {
    const locations = [{ path: "src/first.ts" }]
    Object.defineProperty(locations, 1, { get() { throw new Error("Unused location was evaluated") } })
    expect(deriveProviderToolActivityPresentation({ title: "Read File", data: { locations } }))
      .toEqual({ summary: "Read file", detail: "src/first.ts" })
  })

  it("humanizes MCP tool names and surfaces the save path", () => {
    expect(
      deriveProviderToolActivityPresentation({
        toolName: "mcp__betterc0de__generate_image",
        input: { prompt: "a blue rocket", save_path: "assets/hero.png" },
      })
    ).toEqual({
      summary: "Generate image",
      detail: "assets/hero.png",
    })
  })

  it("falls back to the prompt when an MCP tool has no path input", () => {
    expect(
      deriveProviderToolActivityPresentation({
        toolName: "mcp__betterc0de__generate_image",
        input: { prompt: "a blue rocket" },
      })
    ).toEqual({
      summary: "Generate image",
      detail: "a blue rocket",
    })
  })

  it("shows the real command instead of the shell wrapper", () => {
    expect(
      deriveProviderToolActivityPresentation({
        toolName: "shell",
        input: { command: ["bash", "-lc", "npm test"] },
      })
    ).toEqual({
      summary: "Ran command",
      detail: "npm test",
    })
  })

  it("uses raw output file counts when search tools have no explicit query", () => {
    expect(
      deriveProviderToolActivityPresentation({
        toolName: "find",
        output: { totalFiles: 42, truncated: true },
      })
    ).toEqual({
      summary: "Searched files",
      detail: "42 files+",
    })
  })

  it("uses the first meaningful raw output line as a fallback detail", () => {
    expect(
      deriveProviderToolActivityPresentation({
        toolName: "custom_tool",
        output: {
          stdout: "\n``` \ncreated src/app.ts\nmore output\n",
        },
      })
    ).toEqual({
      summary: "custom_tool",
      detail: "created src/app.ts",
    })
  })

  it("uses structured file paths for read-file dynamic tools", () => {
    expect(
      deriveProviderToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      })
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    })
  })

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveProviderToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      })
    ).toEqual({
      summary: "Read file",
    })
  })
})

// Shapes below are taken from the provider runtime journal of a real Grok CLI
// thread: Grok names the file `target_file`, retitles a call on every event,
// and for a search the title is the pattern itself.
describe("describeProviderToolActivity", () => {
  it("reads the file of a Grok read from target_file", () => {
    expect(
      describeProviderToolActivity({
        toolName: "read_file",
        title: "Read `C:\\repo\\a.tsx`",
        kind: "read",
        input: { variant: "ReadFile", target_file: "C:\\repo\\a.tsx", limit: 100 },
      })
    ).toEqual({
      action: "read",
      summary: "Read file",
      detail: "C:\\repo\\a.tsx",
      path: "C:\\repo\\a.tsx",
    })
  })

  it("classifies the first ACP event by its tool name before a kind arrives", () => {
    expect(
      describeProviderToolActivity({
        toolName: "read_file",
        input: { target_file: "C:\\repo\\a.tsx", limit: 100 },
      })
    ).toMatchObject({ action: "read", path: "C:\\repo\\a.tsx" })
    expect(
      describeProviderToolActivity({
        toolName: "grep",
        input: { pattern: "foo", glob: "**/*.ts", path: "C:\\repo\\src" },
      })
    ).toEqual({
      action: "search",
      summary: "Searched files",
      detail: "foo",
      pattern: "foo",
      scope: "C:\\repo\\src",
    })
  })

  it("keeps a search a search when its title is the pattern", () => {
    expect(
      describeProviderToolActivity({
        toolName: "grep",
        title: "readFile",
        kind: "search",
        input: { variant: "Grep", pattern: "readFile", path: null, glob: "apps/**/*.ts" },
      })
    ).toEqual({
      action: "search",
      summary: "Searched files",
      detail: "readFile",
      pattern: "readFile",
      scope: "apps/**/*.ts",
    })
    // Persisted rows carry the title as the name; the input still says search.
    expect(
      describeProviderToolActivity({
        toolName: "readFile",
        input: { variant: "Grep", pattern: "readFile", path: "C:\\repo\\src" },
      })
    ).toMatchObject({ action: "search", pattern: "readFile" })
  })

  it("never lets a path argument containing 'command' turn a call into a command", () => {
    expect(
      describeProviderToolActivity({
        toolName: "isSlashCommand",
        input: { pattern: "isSlashCommand", path: "C:\\repo\\slash-command-runtime.ts" },
      })
    ).toMatchObject({ action: "search" })
    expect(
      describeProviderToolActivity({
        toolName: "Read `C:\\repo\\slash-command-runtime.ts`",
        input: { target_file: "C:\\repo\\slash-command-runtime.ts" },
      })
    ).toMatchObject({ action: "read", path: "C:\\repo\\slash-command-runtime.ts" })
  })

  it("lists a directory even when the provider only says 'other'", () => {
    expect(
      describeProviderToolActivity({
        toolName: "list_dir",
        title: "List `C:\\repo\\apps\\shell`",
        kind: "other",
        input: { variant: "ListDir", target_directory: "C:\\repo\\apps\\shell" },
      })
    ).toEqual({
      action: "list",
      summary: "Listed directory",
      detail: "C:\\repo\\apps\\shell",
      path: "C:\\repo\\apps\\shell",
    })
  })

  it("surfaces the command of a Grok shell call", () => {
    expect(
      describeProviderToolActivity({
        toolName: "bash",
        title: "Execute `npm test`",
        kind: "execute",
        input: { variant: "Bash", command: "npm test", description: "run tests" },
      })
    ).toEqual({
      action: "command",
      summary: "Ran command",
      detail: "npm test",
      command: "npm test",
    })
  })

  it("keeps plan updates out of 'Changed files'", () => {
    expect(
      describeProviderToolActivity({
        toolName: "todo_write",
        title: "Updating plan",
        kind: "think",
        input: { variant: "TodoWrite", todos: [] },
      })
    ).toEqual({ action: "other", summary: "Updating plan" })
    expect(
      describeProviderToolActivity({ toolName: "TodoWrite", input: { todos: [] } })
    ).toEqual({ action: "other", summary: "TodoWrite" })
  })

  it("ignores a lifecycle item type handed over as a kind and classifies from the input", () => {
    expect(
      describeProviderToolActivity({
        toolName: "exec_command",
        kind: "command_execution",
        input: { command: "npm test" },
      })
    ).toMatchObject({ action: "command", command: "npm test" })
  })

  it("still classifies Claude's native tools from their inputs", () => {
    expect(
      describeProviderToolActivity({ toolName: "Read", input: { file_path: "src/a.ts" } })
    ).toMatchObject({ action: "read", path: "src/a.ts" })
    expect(
      describeProviderToolActivity({
        toolName: "Write",
        input: { file_path: "src/a.ts", content: "x" },
      })
    ).toMatchObject({ action: "file_change", path: "src/a.ts" })
    expect(
      describeProviderToolActivity({
        toolName: "Edit",
        input: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
      })
    ).toMatchObject({ action: "file_change" })
    expect(
      describeProviderToolActivity({ toolName: "Glob", input: { pattern: "**/*.ts", path: "src" } })
    ).toEqual({
      action: "search",
      summary: "Searched files",
      detail: "**/*.ts",
      pattern: "**/*.ts",
      scope: "src",
    })
    expect(
      describeProviderToolActivity({ toolName: "Bash", input: { command: "npm test" } })
    ).toMatchObject({ action: "command", command: "npm test" })
  })
})

describe("extractToolOutputText", () => {
  it("digs the text out of an ACP result envelope", () => {
    expect(
      extractToolOutputText({
        toolCallId: "c1",
        rawInput: { target_file: "a.ts" },
        content: [{ type: "content", content: { type: "text", text: "1→export {}" } }],
        rawOutput: { type: "ReadFile", FileContent: { content: "1→export {}" } },
      })
    ).toBe("1→export {}")
  })

  it("reads Grok result envelopes that carry no content blocks", () => {
    expect(
      extractToolOutputText({ rawOutput: { type: "ListDir", Content: { content: "- a/\n- b/" } } })
    ).toBe("- a/\n- b/")
    expect(
      extractToolOutputText({ type: "Bash", output: [55, 10], output_for_prompt: "exit: 0\n7\n", exit_code: 0 })
    ).toBe("exit: 0\n7\n")
  })

  it("ignores byte arrays and joins stdout with stderr", () => {
    expect(extractToolOutputText({ stdout: [60, 61], stderr: [] })).toBeUndefined()
    expect(extractToolOutputText({ stdout: "ok", stderr: "warn" })).toBe("ok\nwarn")
    expect(extractToolOutputText({ stdout: "ok\n", stderr: "" })).toBe("ok\n")
  })

  it("handles MCP content blocks, plain strings and text-free results", () => {
    expect(
      extractToolOutputText({ content: [{ type: "text", text: "hi" }], is_error: false })
    ).toBe("hi")
    expect(extractToolOutputText("plain")).toBe("plain")
    expect(extractToolOutputText({ exit_code: 0 })).toBeUndefined()
    expect(extractToolOutputText(undefined)).toBeUndefined()
  })
})
