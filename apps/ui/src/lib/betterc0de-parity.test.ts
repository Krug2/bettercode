import { describe, expect, it } from "vitest"
import {
  buildBetterC0deCliParityMarkdown,
  buildBetterC0deGapMarkdown,
  buildBetterC0deHttpParityMarkdown,
  buildBetterC0deParityMarkdown,
  BETTERC0DE_CLI_ENTRYPOINTS,
  BETTERC0DE_HTTP_OPERATIONS,
  BETTERC0DE_PARITY_AREAS,
  betterC0deGapRows,
} from "@/lib/betterc0de-parity"
import { BETTERC0DE_KEYBIND_DEFAULTS } from "@/lib/betterc0de-keybinds"

describe("BetterC0de parity audit", () => {
  it("covers the major BetterC0de integration surfaces", () => {
    expect(BETTERC0DE_PARITY_AREAS.map((area) => area.id)).toEqual([
      "command-map",
      "composer-input",
      "project-config",
      "provider-policy",
      "agents-skills-commands",
      "mcp-references",
      "formatters-lsp",
      "permissions-approvals",
      "runtime-limits",
      "sessions",
      "session-io-stats",
      "github-pr-workflows",
      "debug-diagnostics",
      "sharing",
      "plugins",
      "server-enterprise",
    ])
  })

  it("renders a chat-readable audit with settings and slash entrypoints", () => {
    const output = buildBetterC0deParityMarkdown()

    expect(output).toContain("# BetterC0de Compatibility Audit")
    expect(output).toContain("Settings > Compatibility")
    expect(output).toContain("`/keybinds`")
    expect(output).toContain("/input-actions")
    expect(output).toContain("/pty.list")
    expect(output).toContain("/worktree.create")
    expect(output).toContain("/project.current")
    expect(output).toContain("/betterc0de-api")
    expect(output).toContain("prompt.clear")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "command-map")
        ?.evidence
    ).toContain("prompt.autocomplete.*")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "command-map")
        ?.evidence
    ).toContain("catalog-driven `tui.command.execute` routing")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "command-map")
        ?.evidence
    ).toContain("keybind-only command ids")
    expect(output).toContain("account.login")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "provider-policy")
        ?.evidence
    ).toContain("redacted provider environment variable names")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "provider-policy")
        ?.evidence
    ).toContain("safe provider options")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "provider-policy")
        ?.evidence
    ).toContain("providers list/logout no-argument validation")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "provider-policy")
        ?.evidence
    ).toContain("console orgs/switch/open no-argument validation")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "project-config")
        ?.evidence
    ).toContain("BetterC0de `$schema`")
    expect(output).toContain("/config.update")
    expect(output).toContain("/models <query> --verbose")
    expect(output).toContain("/lsp diagnostics <file>")
    expect(output).toContain("/reject-question")
    expect(output).toContain("question.reject")
    expect(output).toContain("/session.list --format json")
    expect(output).toContain("/session.get")
    expect(output).toContain("/session.messages")
    expect(output).toContain("/tool.list")
    expect(output).toContain("/session.status")
    expect(output).toContain("/betterc0de-sync")
    expect(output).toContain("/github.install")
    expect(output).toContain("/global.health")
    expect(output).toContain("/path.get")
    expect(output).toContain("/pr <number>")
    expect(output).toContain(
      "`/export, /import <file.json\\|url>, /betterc0de-import, /stats`"
    )
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "session-io-stats")
        ?.evidence
    ).toContain("BetterC0de share-array import")
    expect(output).toContain(
      "`/debug-info, /global.health, /debug.paths, /paths, /path.get, /debug.config, /debug.lsp, /debug-rg, /debug.file.read, /file.read, /file.list, /file.status, /find, /find.file, /find.symbol, /events, /event.subscribe, /debug-snapshot, /debug-startup, /debug-v2, /vcs, /vcs.get, /vcs.status, /vcs.diff, /vcs.apply, /db.path`"
    )
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "debug-diagnostics")
        ?.evidence
    ).toContain("direct file.read/file.list/file.status")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "debug-diagnostics")
        ?.evidence
    ).toContain("event.subscribe snapshots")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "debug-diagnostics")
        ?.evidence
    ).toContain("external plugins disabled (--pure)")
    expect(output).toContain("debug.agent")
    expect(output).toContain("/agent-create")
    expect(output).toContain("mcp.auth.list")
    expect(output).toContain("/mcp-resources")
    expect(output).toContain("/mcp-add")
    expect(output).toContain("/plugin-install")
    expect(output).toContain("/questions")
    expect(output).toContain("/answer")
    expect(output).toContain("/vcs.diff")
    expect(output).toContain("/betterc0de-tui")
    expect(output).toContain("/betterc0de-serve")
    expect(output).toContain("/betterc0de-attach")
    expect(output).toContain("/betterc0de-upgrade")
    expect(output).toContain("/betterc0de-completion")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "server-enterprise")
        ?.evidence
    ).toContain("db migrate aliases")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "server-enterprise")
        ?.evidence
    ).toContain("shell completion")
    expect(
      BETTERC0DE_PARITY_AREAS.find((area) => area.id === "github-pr-workflows")
        ?.evidence
    ).toContain("comment/issue/pr/manual/scheduled trigger aliases")
    expect(output).toContain("Display-only")
    expect(output).toContain("Status Legend")
  })

  it("renders command-by-command compatibility CLI parity", () => {
    const output = buildBetterC0deCliParityMarkdown()

    expect(BETTERC0DE_CLI_ENTRYPOINTS.length).toBeGreaterThan(30)
    expect(output).toContain("# BetterC0de CLI Compatibility")
    expect(output).toContain("`betterc0de run [message..]`")
    expect(output).toContain("`/betterc0de-run`")
    expect(output).toContain("`betterc0de console login <url>`")
    expect(output).toContain("`/console.login`")
    expect(output).toContain("`betterc0de auth login [url]`")
    expect(output).toContain("`/auth.login`")
    expect(output).toContain("`betterc0de auth logout`")
    expect(output).toContain("`/auth.logout`")
    expect(output).toContain("`betterc0de providers ls`")
    expect(output).toContain("`/providers.ls`")
    expect(output).toContain("`betterc0de auth ls`")
    expect(output).toContain("`/auth.ls`")
    expect(output).toContain("`betterc0de mcp auth list`")
    expect(output).toContain("`/mcp.auth.list`")
    expect(output).toContain("`betterc0de mcp ls`")
    expect(output).toContain("`/mcp.ls`")
    expect(output).toContain("`betterc0de mcp auth ls`")
    expect(output).toContain("`/mcp.auth.ls`")
    expect(output).toContain("`betterc0de debug skill`")
    expect(output).toContain("`/debug.skill`")
    expect(output).toContain("`betterc0de plug <module>`")
    expect(output).toContain("`/plug`")
    expect(output).toContain("`betterc0de debug config`")
    expect(output).toContain("`/debug.config`")
    expect(output).toContain("Settings > Compatibility")
  })

  it("filters command-by-command compatibility CLI parity", () => {
    const output = buildBetterC0deCliParityMarkdown(["mcp", "auth"])

    expect(output).toContain("Filter: `mcp auth`")
    expect(output).toContain("`betterc0de mcp auth [name]`")
    expect(output).toContain("`betterc0de mcp auth list`")
    expect(output).not.toContain("`betterc0de run [message..]`")
  })

  it("renders BetterC0de HTTP/API operation parity", () => {
    const output = buildBetterC0deHttpParityMarkdown()
    const ids = BETTERC0DE_HTTP_OPERATIONS.map((operation) => operation.id)

    expect(BETTERC0DE_HTTP_OPERATIONS.length).toBe(131)
    expect(new Set(ids).size).toBe(BETTERC0DE_HTTP_OPERATIONS.length)
    expect(
      BETTERC0DE_HTTP_OPERATIONS.filter(
        (operation) => operation.status === "display-only"
      )
    ).toEqual([])
    expect(output).toContain("# BetterC0de HTTP/API Compatibility")
    expect(output).toContain("Tracked operations: 131")
    expect(output).toContain("Display-only: 0")
    expect(output).toContain("`session.prompt`")
    expect(output).toContain("`POST /session/{sessionID}/message`")
    expect(output).toContain("`/session.prompt`")
    expect(output).toContain("`file.read`")
    expect(output).toContain("`GET /file/content`")
    expect(output).toContain("`/file.read`")
    expect(output).toContain("`v2.session.wait`")
    expect(output).toContain("`/v2.session.wait`")
    expect(output).toContain("`sync.history.list`")
    expect(output).toContain("`/betterc0de-sync, /sync.history.list`")
    expect(output).toContain("`auth.set`")
    expect(output).toContain("`/auth.set`")
    expect(output).toContain("`experimental.resource.list`")
    expect(output).toContain("`/mcp-resources`")
    expect(output).toContain("`tui.executeCommand`")
    expect(output).toContain("`/tui.executeCommand`")
    expect(output).toContain("Display-only")
  })

  it("filters BetterC0de HTTP/API operation parity", () => {
    const output = buildBetterC0deHttpParityMarkdown(["mcp", "auth"])

    expect(output).toContain("Filter: `mcp auth`")
    expect(output).toContain("`mcp.auth.start`")
    expect(output).toContain("`mcp.auth.remove`")
    expect(output).not.toContain("`session.prompt`")
  })

  it("renders a focused BetterC0de gap report", () => {
    const rows = betterC0deGapRows()
    const output = buildBetterC0deGapMarkdown()
    const statuses: string[] = rows.map((row) => row.status)

    expect(rows.length).toBeGreaterThan(20)
    expect(statuses).not.toContain("implemented")
    expect(statuses).not.toContain("native")
    expect(output).toContain("# BetterC0de Gap Report")
    expect(output).toContain("Tracked gaps:")
    expect(output).toContain("Feature areas:")
    expect(output).toContain("`betterc0de github install`")
    expect(output).toContain("`/github.install`")
    expect(output).toContain("`POST /sync/start`")
    expect(output).toContain("Display-only")
  })

  it("filters the BetterC0de gap report", () => {
    const output = buildBetterC0deGapMarkdown(["sync"])

    expect(output).toContain("Filter: `sync`")
    expect(output).toContain("`POST /sync/start`")
    expect(output).toContain("`POST /sync/replay`")
    expect(output).not.toContain("`betterc0de github install`")
  })

  it("tracks BetterC0de theme and terminal system command keybinds", () => {
    const byId = new Map(BETTERC0DE_KEYBIND_DEFAULTS.map((entry) => [entry.id, entry]))
    const byCommand = new Map(
      BETTERC0DE_KEYBIND_DEFAULTS.map((entry) => [entry.command, entry])
    )

    expect(byId.get("theme_switch_mode")).toMatchObject({
      command: "theme.switch_mode",
      slash: "/theme-mode",
    })
    expect(byId.get("theme_mode_lock")).toMatchObject({
      command: "theme.mode.lock",
      slash: "/theme-mode-lock",
    })
    expect(byId.get("terminal_title_toggle")).toMatchObject({
      command: "terminal.title.toggle",
      slash: "/terminal-title",
    })
    expect(byId.get("app_heap_snapshot")).toMatchObject({
      command: "app.heap_snapshot",
      slash: "/heap-snapshot",
    })

    for (const command of [
      "app.toggle.animations",
      "app.toggle.file_context",
      "app.toggle.diffwrap",
      "app.toggle.paste_summary",
      "app.toggle.session_directory_filter",
      "docs.open",
      "help.show",
      "session.toggle.scrollbar",
      "session.toggle.timestamps",
      "session.toggle.generic_tool_output",
      "model.dialog.provider",
      "model.dialog.favorite",
      "model.cycle_favorite",
      "model.cycle_favorite_reverse",
      "provider.connect",
      "console.org.switch",
      "variant.list",
      "session.message.next",
      "session.message.previous",
      "session.messages_last_user",
      "session.toggle.actions",
      "session.toggle.thinking",
      "prompt.editor_context.clear",
      "prompt.skills",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "terminal.suspend",
      "tips.toggle",
      "plugins.list",
      "plugins.install",
      "which-key.toggle",
      "which-key.layout.toggle",
      "which-key.pending.toggle",
      "which-key.group.previous",
      "which-key.group.next",
      "which-key.scroll.up",
      "which-key.scroll.down",
      "which-key.page.up",
      "which-key.page.down",
      "which-key.home",
      "which-key.end",
    ]) {
      expect(byCommand.get(command), command).toBeTruthy()
    }
  })
})
