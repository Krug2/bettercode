import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ToolCallGroup,
  type ToolCallGroupWorkEntry,
} from "@/components/chat/tool-call-group"
import type { ToolCallData } from "@/components/chat/tool-call-item"

/**
 * A long run produces dozens of rows of the same action, which pushes the
 * informative ones off screen. Adjacent same-action rows are folded into one
 * countable row whose label lists what differed. These tests render the real
 * component so the folding is verified where the user meets it, not only in
 * the pure helper.
 */

function bash(id: string, command: string): ToolCallData {
  return {
    id,
    name: "Bash",
    input: { command },
    output: "ok",
    state: "output-available",
  }
}

/**
 * A Grok ACP read exactly as the journal records it: the tool name from the
 * first event, the later title with the path in backticks, the file under
 * `target_file`, and a result envelope with the text three levels down.
 */
function grokRead(id: string, file: string): ToolCallData {
  return {
    id,
    name: "read_file",
    title: `Read \`${file}\``,
    kind: "read",
    input: { variant: "ReadFile", target_file: file, limit: 100 },
    output: {
      toolCallId: id,
      rawOutput: { type: "ReadFile", FileContent: { content: "1→export {}" } },
      content: [{ type: "content", content: { type: "text", text: "1→export {}" } }],
    },
    state: "output-available",
  }
}

function render(
  tools: ToolCallData[],
  work: ToolCallGroupWorkEntry[] = []
): string {
  return renderToStaticMarkup(
    <ToolCallGroup tools={tools} work={work} defaultOpen />
  )
}

/** How many times a folded-run marker appears, e.g. "×4". */
function foldMarkers(html: string): string[] {
  return html.match(/×\d+/g) ?? []
}

describe("ToolCallGroup folding", () => {
  it.each([['grok_cli', 'grok.svg'], ['claude', 'claude.svg'], ['codex', 'openai.svg']])("uses the %s provider logo for completed activity", (providerKind, logo) => {
    const html = renderToStaticMarkup(<ToolCallGroup tools={[{ ...bash("done", "pwd"), providerKind }]} />)
    expect(html).toContain(`/providers/${logo}`)
    expect(html).not.toContain("lucide-wrench")
  })
  it.each([
    { name: "Grep", input: { pattern: "auth" }, orb: "searching" },
    { name: "Edit", input: { file_path: "src/auth.ts" }, orb: "shaping" },
    { name: "Bash", input: { command: "npm test" }, orb: "working" },
  ])("animates the current $name activity, not an earlier completed tool", ({ name, input, orb }) => {
    const html = renderToStaticMarkup(<ToolCallGroup streaming tools={[
      bash("complete", "npm install"),
      { id: "active", name, input, state: "input-available" },
    ]} />)
    expect(html).toContain(`data-agent-orb="${orb}"`)
  })

  it("stops the activity animation after tool completion even while the turn streams", () => {
    const html = renderToStaticMarkup(<ToolCallGroup streaming tools={[bash("complete", "npm test")]} />)
    expect(html).not.toContain("data-agent-orb")
    expect(html).toContain("1 step")
  })

  it("shows failed tool output instead of only a generic failure label", () => {
    const html = render([{ ...bash("failed", "npm test"), state: "output-error", error: "Tool failed", output: { error: { message: "Permission denied\nCheck workspace trust." } } }])
    expect(html).toContain("Permission denied")
    expect(html).toContain("Check workspace trust.")
    expect(html).toContain("Copy error details")
    expect(html).toContain("<details>")
    expect(html).not.toContain("No further error details")
  })
  it("keeps runtime failure details visible at narrow widths", () => {
    const html = render([], [{ id: "error", label: "Connection to provider failed", detail: "The provider is retrying this request.", diagnostics: "Type: transport_error", tone: "error", kind: "runtime.error", createdAt: "2026-09-14T12:00:00Z" }])
    expect(html).toContain("The provider is retrying this request.")
    expect(html).toContain("Type: transport_error")
    expect(html).not.toContain("sm:inline")
  })
  it("folds four identical runs into one counted row", () => {
    const html = render([
      bash("a", "npm test"),
      bash("b", "npm test"),
      bash("c", "npm test"),
      bash("d", "npm test"),
    ])
    expect(foldMarkers(html)).toEqual(["×4"])
  })

  it("leaves a run below the threshold alone", () => {
    // MIN_FOLDED_RUN_LENGTH is 3: folding two rows would hide as much as it
    // saves, and the count would read as noise.
    const html = render([bash("a", "npm test"), bash("b", "npm test")])
    expect(foldMarkers(html)).toEqual([])
  })

  it("folds same-action rows and spells out what differed", () => {
    const html = render([
      bash("a", "npm test"),
      bash("b", "git status"),
      bash("c", "npm run lint"),
      bash("d", "ls"),
    ])
    expect(foldMarkers(html)).toEqual(["×4"])
    expect(html).toContain("Ran command ×4 · npm test, git status, npm run lint, +1")
  })

  it("folds each action run separately instead of merging across them", () => {
    const html = render([
      bash("a", "npm test"),
      bash("b", "npm test"),
      bash("c", "npm test"),
      grokRead("d", "C:\\repo\\apps\\ui\\src\\a.tsx"),
      bash("e", "npm run lint"),
      bash("f", "npm run lint"),
      bash("g", "npm run lint"),
    ])
    expect(foldMarkers(html)).toEqual(["×3", "×3"])
    expect(html).toContain("Ran command ×3 · npm test")
    expect(html).toContain("Ran command ×3 · npm run lint")
  })

  it("folds the identical hook rows that several plugins produce per turn", () => {
    const hook = (id: string, label: string, detail?: string): ToolCallGroupWorkEntry => ({
      id,
      label,
      ...(detail ? { detail } : {}),
      tone: "info",
      kind: label.startsWith("Hook started") ? "hook.started" : "hook.completed",
      createdAt: "2026-09-17T01:30:28.988Z",
    })
    const html = render(
      [],
      [
        hook("s1", "Hook started: SessionStart:resume"),
        hook("s2", "Hook started: SessionStart:resume"),
        hook("s3", "Hook started: SessionStart:resume"),
        hook("c1", "Hook completed", "success"),
        hook("c2", "Hook completed", "success"),
        hook("c3", "Hook completed", "success"),
      ]
    )
    expect(foldMarkers(html)).toEqual(["×3", "×3"])
    expect(html).toContain("Hook started: SessionStart:resume ×3")
    expect(html).toContain("Hook completed ×3 · success")
  })

  it("never folds a failed hook away", () => {
    const failed: ToolCallGroupWorkEntry = {
      id: "f",
      label: "Hook failed",
      detail: "exit code 1",
      tone: "error",
      kind: "hook.completed",
      createdAt: "2026-09-17T01:30:29.000Z",
    }
    const html = render([], [failed, { ...failed, id: "g" }, { ...failed, id: "h" }])
    expect(foldMarkers(html)).toEqual([])
  })

  it("names the files of a folded Grok read run", () => {
    const html = render([
      grokRead("a", "C:\\repo\\apps\\ui\\src\\a.tsx"),
      grokRead("b", "C:\\repo\\apps\\ui\\src\\b.tsx"),
      grokRead("c", "C:\\repo\\apps\\ui\\src\\c.tsx"),
      grokRead("d", "C:\\repo\\apps\\ui\\src\\d.tsx"),
    ])
    expect(foldMarkers(html)).toEqual(["×4"])
    expect(html).toContain("Read file ×4 · a.tsx, b.tsx, c.tsx, +1")
  })
})

describe("ToolCallGroup ACP rows", () => {
  it("shows the file of a Grok read, links it, and previews its text", () => {
    const html = render([grokRead("r", "C:\\repo\\apps\\ui\\src\\a.tsx")])
    expect(html).toContain("Read file")
    expect(html).toContain(">a.tsx<")
    expect(html).toContain('aria-label="Open C:/repo/apps/ui/src/a.tsx in editor"')
    expect(html).toContain("1→export {}")
    // The result envelope is not the result.
    expect(html).not.toContain("FileContent")
    expect(html).not.toContain("toolCallId")
  })

  it("labels a Grok search by its pattern and scope, never as a read", () => {
    const html = render([
      {
        id: "g",
        name: "grep",
        title: "readFile",
        kind: "search",
        input: { variant: "Grep", pattern: "readFile", path: null, glob: "apps/ui/src/**/*.ts" },
        output: { content: [{ type: "content", content: { type: "text", text: "found 0 matches" } }] },
        state: "output-available",
      },
    ])
    expect(html).toContain("Searched files")
    expect(html).toContain(">readFile<")
    expect(html).toContain("in apps/ui/src/**/*.ts")
    expect(html).not.toContain("Read file")
    expect(html).not.toContain("Ran command")
    expect(html).not.toContain("in editor")
  })

  it("does not turn a search scoped to a path containing 'command' into a command", () => {
    const html = render([
      {
        id: "g2",
        name: "grep",
        title: "isSlashCommand",
        kind: "search",
        input: {
          variant: "Grep",
          pattern: "isSlashCommand",
          path: "C:\\repo\\apps\\ui\\src\\lib\\slash-command-runtime.ts",
        },
        output: "found 2 matches",
        state: "output-available",
      },
    ])
    expect(html).toContain("Searched files")
    expect(html).toContain("in slash-command-runtime.ts")
    expect(html).not.toContain("Ran command")
  })

  it("shows the directory of a Grok list without an editor link", () => {
    const html = render([
      {
        id: "l",
        name: "list_dir",
        title: "List `C:\\repo\\apps\\shell`",
        kind: "other",
        input: { variant: "ListDir", target_directory: "C:\\repo\\apps\\shell" },
        output: { rawOutput: { type: "ListDir", Content: { content: "- shell/\n  - main.cjs" } } },
        state: "output-available",
      },
    ])
    expect(html).toContain("Listed directory")
    expect(html).toContain(">shell<")
    expect(html).toContain("main.cjs")
    expect(html).not.toContain("in editor")
  })

  it("renders nothing at all when there is no work to show", () => {
    // A group that renders an empty shell leaves a stray gap between messages.
    expect(render([])).toBe("")
  })
})
