import { describe, expect, it } from "vitest"
import {
  BUILTIN_COMMANDS,
  detectSlashCommandTrigger,
  filterBuiltinCommandsForBetterC0deShareMode,
  filterSlashCommandsForQuery,
  filterComposerCommands,
  isReservedBuiltinSlashCommandName,
  projectCommandSlashCommands,
  projectSkillSlashCommands,
  providerSkillCommands,
  replaceSlashCommandTriggerRange,
  slashCommandEmptyStateText,
  slashCommandSelectionReplacement,
  type SlashCommand,
} from "@/components/slash-commands"
import { BETTERC0DE_INPUT_ACTION_COMMANDS } from "@/lib/betterc0de-keybinds"

describe("detectSlashCommandTrigger", () => {
  it.each(["/goal ", "/goal pa", "/goal con", "/goal res", "/GOAL  PA"])("offers goal controls after whitespace: %s", text => {
    expect(detectSlashCommandTrigger(text)).toEqual({ trigger: "/", query: text.slice(1), rangeStart: 0, rangeEnd: text.length })
  })

  it.each(["/goal Fix the editor", "/goal edit Fix this", "/goal pause ", "/goal continue working", "/goal\n"])("leaves goal text and selected controls alone: %s", text => {
    expect(detectSlashCommandTrigger(text)).toBeNull()
  })

  it("replaces the whole goal subcommand while preserving text after the cursor", () => {
    const text = "/goal ed Fix the sidebar"
    const trigger = detectSlashCommandTrigger(text, "/goal ed".length)!
    const command = BUILTIN_COMMANDS.find(command => command.name === "/goal edit")!
    expect(replaceSlashCommandTriggerRange(text, { start: trigger.rangeStart, end: trigger.rangeEnd }, slashCommandSelectionReplacement(command))).toEqual({
      text: "/goal edit Fix the sidebar", cursor: "/goal edit ".length,
    })
  })

  it("ends skill tokens at newlines and starts a new command on the next line", () => {
    for (const prefix of ["a$skill", "$$skill", "$skill"]) {
      expect(detectSlashCommandTrigger(prefix + "\n")).toBeNull()
      expect(detectSlashCommandTrigger(prefix + "\r\n")).toBeNull()
      expect(detectSlashCommandTrigger(prefix + "\n/rev")?.query).toBe("rev")
    }
  })

  it("detects slash commands at the current line start", () => {
    const text = "First line\n/rev"

    expect(detectSlashCommandTrigger(text, text.length)).toEqual({
      trigger: "/",
      query: "rev",
      rangeStart: "First line\n".length,
      rangeEnd: text.length,
    })
  })

  it("detects provider skill tokens anywhere in the prompt", () => {
    const text = "Use $gh-fi for this PR"
    const cursor = "Use $gh-fi".length

    expect(detectSlashCommandTrigger(text, cursor)).toEqual({
      trigger: "$",
      query: "gh-fi",
      rangeStart: "Use ".length,
      rangeEnd: cursor,
    })
  })

  it("ignores slash commands after additional prompt text", () => {
    const text = "/plan explain this"

    expect(detectSlashCommandTrigger(text, text.length)).toBeNull()
  })
})

describe("filterSlashCommandsForQuery", () => {
  it("shows scoped goal controls without filling the root menu with them", () => {
    expect(filterComposerCommands(BUILTIN_COMMANDS, "goal ").map(command => command.name)).toEqual(expect.arrayContaining([
      "/goal pause", "/goal continue", "/goal edit", "/goal status", "/goal clear", "/goal set",
    ]))
    expect(filterComposerCommands(BUILTIN_COMMANDS, "goal pa").map(command => command.name)).toEqual(["/goal pause"])
    expect(filterComposerCommands(BUILTIN_COMMANDS, "GOAL  RES").map(command => command.name)).toEqual(["/goal continue"])
    expect(filterComposerCommands(BUILTIN_COMMANDS, "").some(command => command.name.startsWith("/goal "))).toBe(false)
    expect(filterComposerCommands(BUILTIN_COMMANDS, "").some(command => command.name === "/goal")).toBe(true)
  })

  const commands: SlashCommand[] = [
    {
      id: "provider-review",
      name: "/review",
      description: "Review a pull request",
      category: "provider",
      action: "insert",
    },
    {
      id: "provider-compact",
      name: "/compact",
      description: "Compact conversation",
      category: "provider",
      action: "insert",
    },
    {
      id: "skill-gh-fix-ci",
      name: "$gh-fix-ci",
      description: "Fix GitHub Actions failures",
      category: "skill",
      action: "insert",
    },
    {
      id: "skill-imagegen",
      name: "$imagegen",
      description: "Generate images",
      category: "skill",
      action: "insert",
    },
  ]

  it("fuzzy-matches provider skill names in skill search", () => {
    expect(
      filterSlashCommandsForQuery(commands, "gfc", "$").map(
        (command) => command.name
      )
    ).toEqual(["$gh-fix-ci"])
  })

  it("matches provider slash command descriptions", () => {
    expect(
      filterSlashCommandsForQuery(commands, "pull", "/").map(
        (command) => command.name
      )
    ).toEqual(["/review"])
  })

  it("exposes BetterC0de plan mode slash commands in the built-in menu", () => {
    const builtIns = BUILTIN_COMMANDS.map((command) => command.name)

    expect(builtIns).toEqual(
      expect.arrayContaining([
        "/model",
        "/command-palette",
        "/model-next",
        "/model-previous",
        "/favorite-next",
        "/favorite-toggle",
        "/favorite-previous",
        "/sessions",
        "/session-status",
        "/new",
        "/init",
        "/review",
        "/pr",
        "/github",
        "/review-toggle",
        "/commands",
        "/undo",
        "/redo",
        "/interrupt",
        "/fork",
        "/parent",
        "/child",
        "/child-next",
        "/child-previous",
        "/pin",
        "/pins",
        "/quick-switch",
        "/delete-session",
        "/archive",
        "/unarchive",
        "/archives",
        "/share",
        "/unshare",
        "/copy",
        "/copy-last",
        "/export",
        "/import",
        "/diff",
        "/rename",
        "/timeline",
        "/events",
        "/messages",
        "/context",
        "/history",
        "/history-use",
        "/prompt-clear",
        "/prompt-paste",
        "/prompt-submit",
        "/input-actions",
        "/stash",
        "/stashes",
        "/stash-pop",
        "/stash-delete",
        "/first",
        "/last",
        "/last-user",
        "/next-message",
        "/previous-message",
        "/page-up",
        "/page-down",
        "/half-page-up",
        "/half-page-down",
        "/line-up",
        "/line-down",
        "/open",
        "/add-selection",
        "/editor-context-clear",
        "/close",
        "/file-tree-toggle",
        "/warp",
        "/project-next",
        "/project-previous",
        "/workspace-new",
        "/workspace-toggle",
        "/workspace-list",
        "/workspace-remove",
        "/workspace-reset",
        "/plan",
        "/ask",
        "/default",
        "/chat-mode-next",
        "/chat-mode-previous",
        "/agent",
        "/agent-previous",
        "/input-focus",
        "/exit",
        "/connect",
        "/debug-info",
        "/debug-paths",
        "/debug-rg",
        "/find",
        "/debug-snapshot",
        "/debug-utility",
        "/stats",
        "/docs",
        "/settings",
        "/remote",
        "/providers",
        "/org",
        "/appearance",
        "/rules",
        "/tools",
        "/hooks",
        "/plugins",
        "/plugin-install",
        "/references",
        "/formatters",
        "/lsp",
        "/permissions",
        "/approvals",
        "/approve",
        "/deny",
        "/questions",
        "/answer",
        "/todos",
        "/vcs",
        "/betterc0de-config",
        "/betterc0de-audit",
        "/betterc0de-cli",
        "/betterc0de-api",
        "/betterc0de-gaps",
        "/betterc0de-sync",
        "/betterc0de-workspace",
        "/betterc0de-lifecycle",
        "/tui-control",
        "/betterc0de-internal",
        "/tui",
        "/keybinds",
        "/tips",
        "/betterc0de-tui",
        "/betterc0de-run",
        "/betterc0de-serve",
        "/betterc0de-attach",
        "/betterc0de-web",
        "/betterc0de-acp",
        "/betterc0de-upgrade",
        "/betterc0de-uninstall",
        "/betterc0de-generate",
        "/betterc0de-completion",
        "/betterc0de-db",
        "/project-providers",
        "/project-plugins",
        "/project-tools",
        "/mcps",
        "/mcp-resources",
        "/mcp-auth",
        "/mcp-add",
        "/mcp-logout",
        "/mcp-debug",
        "/mcp-toggle",
        "/agent-create",
        "/console",
        "/heap-snapshot",
        "/terminal",
        "/terminal-title",
        "/terminal-new",
        "/sidebar",
        "/animations",
        "/file-context",
        "/paste-summary",
        "/session-directory-filter",
        "/auth",
        "/themes",
        "/theme-mode",
        "/theme-mode-lock",
        "/terminal-font",
        "/variants",
        "/variant.cycle",
        "/catalog",
        "/streaming",
        "/timestamps",
        "/thinking",
        "/reasoning-summaries",
        "/tool-details",
        "/progress",
        "/shell-expanded",
        "/edit-expanded",
        "/scrollbar",
        "/generic-tool-output",
        "/conceal",
        "/autosave",
        "/diffwrap",
        "/diff-style",
        "/confirmations",
        "/notifications",
        "/autoaccept",
        "/compact",
        "/density",
      ])
    )
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "pla", "/").map(
        (command) => command.name
      )
    ).toEqual(expect.arrayContaining(["/plan"]))
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "pla", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/plan")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mod", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/model")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "model.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/model")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "model.choose", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/model")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "command.palette.show",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/command-palette")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "model.cycle_recent",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/model-next")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "model.cycle_favorite_reverse",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/favorite-previous")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "model.dialog.favorite",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/favorite-toggle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "resume", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.next", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "theme", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/themes")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "theme.switch", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/themes")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "theme.switch_mode",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/theme-mode")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "theme.mode.lock", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/theme-mode-lock")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "theme.cycle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/themes")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "which-key", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/keybinds")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "debug.lsp.diagnostics",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/lsp")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "tips.toggle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/tips")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "plugins.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/plugins")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "plugins.toggle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/plugin-toggle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "plugins.install", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/plugin-install")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "dialog.plugins.install",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/plugin-install")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.thread", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-tui")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.serve", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-serve")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.attach", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-attach")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "server.switch", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-attach")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "terminal.title.toggle",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/terminal-title")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "betterc0de.uninstall",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/betterc0de-uninstall")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "catalog.model.list",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/catalog")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "models.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/catalog")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "auth.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "provider.auth", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "github.install", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/github")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "github.pr", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/pr")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "agent", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/agent")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "agent.cycle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/agent")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mode-next", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/chat-mode-next")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "clear", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/new")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "wrap", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/diffwrap")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "diff.style", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/diff-style")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "confirm", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/confirmations")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "auto-accept", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/autoaccept")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "permissions.autoaccept",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/autoaccept")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "file.open", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/open")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "tab.close", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/close")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "terminal.toggle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/terminal")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.toggle", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-toggle")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "dialog.mcp.toggle",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/mcp-toggle")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.toggle.progress_bar",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/progress")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.toggle.reasoning_summaries",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/reasoning-summaries")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.toggle.shell_tool_parts_expanded",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/shell-expanded")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.toggle.edit_tool_parts_expanded",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/edit-expanded")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.interrupt",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/interrupt")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "close-tab", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/close")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "preferences", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/settings")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "settings.open", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/settings")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "provider", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/providers")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "providers.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "providers.ls", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "providers.login", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/connect")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "account.login", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/connect")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "providers.logout",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "account.logout", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "compact-ui", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/density")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "summarize", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/compact")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "toggle-sidebar", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sidebar")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "app.toggle.animations",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/animations")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "app.toggle.file_context",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/file-context")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "app.toggle.paste_summary",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/paste-summary")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "app.toggle.session_directory_filter",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/session-directory-filter")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.copy", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/copy")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.message.list",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/messages")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.context", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/context")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.diff", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/diff")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "event.subscribe", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/events")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.import", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/import")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "messages.copy", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/copy-last")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.parent", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/parent")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.child.next",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/child-next")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.pin", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/pin")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "pinned-sessions", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/pins")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.quick_switch.3",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/quick-switch")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.clear", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/prompt-clear")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.paste", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/prompt-paste")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.submit", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/prompt-submit")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "input.newline", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/input-actions")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "input.delete.word.forward",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/input-actions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.delete", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/delete-session")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.archive", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/archive")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "archived-sessions",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/archives")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.half.page.down",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/half-page-down")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "toggle.actions", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/tool-details")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.toggle.conceal",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/conceal")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "messages.page_up",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/page-up")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "messages.line_down",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/line-down")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "editor", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/open")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.editor", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/open")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "prompt.editor_context.clear",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/editor-context-clear")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "context.addSelection",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/add-selection")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "quit", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/exit")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.exit", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/exit")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "workspace", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/warp")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "workspace.set", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/warp")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "project.open", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/warp")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "project.current", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/workspace-toggle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "project.next", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/project-next")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "workspace.new", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/workspace-new")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "worktree.create", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/workspace-new")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "workspace.toggle",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/workspace-toggle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "workspace.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/workspace-list")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "workspace.remove",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/workspace-remove")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "workspace.reset", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/workspace-reset")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "organization", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/org")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "console.org.switch",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/org")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "console.switch", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/org")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "console.orgs", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/org")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "auth.login", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/connect")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "auth.logout", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "account.orgs", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/org")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de-parity", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-audit")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.commands", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-cli")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.http", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-api")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "betterc0de.missing", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-gaps")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "experimental.resource.list",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/mcp-resources")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "sync.history.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-sync")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "experimental.workspace.warp",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/betterc0de-workspace")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "global.dispose", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-lifecycle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "tui.control.next", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/tui-control")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "config.get", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-config")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "config.providers",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/project-providers")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "command.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/commands")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "tui-config", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/tui")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "keybindings", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/keybinds")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt-history", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/history")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "history-pop", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/history-use")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt-stash", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/stash")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.stash", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/stash")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "stash-list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/stashes")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "prompt-stash-pop",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/stash-pop")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "prompt.stash.list",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/stashes")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "stash.delete", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/stash-delete")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "prompt.skills", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/skills")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.skills", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/skills")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.skill", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/skills")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcps")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.ls", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcps")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.status", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcps")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.auth.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.auth.ls", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-auth")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.add", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-add")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.logout", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-logout")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.debug", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-debug")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "mcp.connect", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-toggle")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "agent.create", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/agent-create")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.stats", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/stats")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.info", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-info")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.paths", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-paths")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "db.path", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-paths")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "paths", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-paths")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.rg.search", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-rg")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.file.read", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-rg")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "file.read", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-rg")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "file.status", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-rg")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "debug.snapshot.diff",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/debug-snapshot")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.v2", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-utility")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.file.tree", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/debug-rg")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "toggle-mcp", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/mcp-toggle")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "model.dialog.provider",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/providers")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.console", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/console")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.debug", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/console")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.log", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/app.log")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "app.heap_snapshot",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/heap-snapshot")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "terminal.new", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/terminal-new")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "pty.create", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/terminal-new")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "pty.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/terminal")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "terminal.suspend",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/terminal")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "permission-list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/approvals")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "permission.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/approvals")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "permission.prompt.fullscreen",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/approvals")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "permission-approve",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/approve")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "reject", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/deny")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "question.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/questions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "question.reply", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/answer")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "question.reject", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/reject-question")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.todo", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/todos")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.status", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/session-status")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "session.get", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "v2.session.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/sessions")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "session.messages",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/messages")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "v2.session.messages",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/messages")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "tool.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/project-tools")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "v2.model.list", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/model")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "vcs.diff.raw", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/vcs")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "find.symbol", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/find")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.agent", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/agents")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "app.agents", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/agents")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.lsp", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/lsp")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "lsp.status", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/lsp")
    expect(
      filterSlashCommandsForQuery(
        BUILTIN_COMMANDS,
        "formatter.status",
        "/"
      ).map((command) => command.name)[0]
    ).toBe("/formatters")
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "debug.config", "/").map(
        (command) => command.name
      )[0]
    ).toBe("/betterc0de-config")
  })

  it("finds remote access by its primary command and alias", () => {
    expect(
      filterSlashCommandsForQuery(BUILTIN_COMMANDS, "remote", "/")[0]?.name
    ).toBe("/remote")
    expect(isReservedBuiltinSlashCommandName("/remote-access")).toBe(true)
  })

  it("reserves built-in slash names so provider commands cannot shadow core commands", () => {
    expect(isReservedBuiltinSlashCommandName("/compact")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/command-palette")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/command.palette.show")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/command-palette-show")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/agent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mode-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent.cycle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent-previous")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mode-previous")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent.cycle.reverse")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.cycle_recent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model-previous")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/model.cycle_recent_reverse")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/favorite-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.cycle_favorite")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/favorite-toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.dialog.favorite")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/favorite-previous")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/model.cycle_favorite_reverse")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/undo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.undo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/fork")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.fork")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/parent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session-parent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.parent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/child")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/children")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session-child")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.child")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.child.first")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/child-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.child.next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/child-previous")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.child.previous")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/pin")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pin-session")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.pin")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.pin.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pins")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pinned")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pinned-sessions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/quick-switch")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.quick_switch.1")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/session.quick_switch.9")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/delete-session")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/delete")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.delete")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/archive")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/archive-session")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.archive")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/unarchive")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/unarchive-session")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.unarchive")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/archives")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/archived")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/archived-sessions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/redo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.redo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/interrupt")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stop")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/cancel")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.interrupt")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/share")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.share")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.unshare")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/copy")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.copy")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/copy-last")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/copy-assistant")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/copy-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.copy")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/export")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.export")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/import")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.import")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/diff")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/diffs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.diff")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/rename")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/title")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.rename")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/timeline")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.timeline")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/events")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/event.subscribe")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.events")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.message.list")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/context")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.context")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/history")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-history")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/histories")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/history-use")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/history-pop")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-history-use")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.history.previous")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/prompt.history.next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-clear")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.clear")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-paste")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.paste")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-submit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.submit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/input-actions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/input.newline")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/input.delete.word.forward")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-stash")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.stash")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stashes")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash-list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-stash-list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.stash.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash-pop")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-stash-pop")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.stash.pop")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash-delete")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash.delete")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stash-remove")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-stash-delete")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/first")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/first-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.first")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.first")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/last")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/last-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.last")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.last")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/last-user")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.last_user")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/session.messages_last_user")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/next-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/message-next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.message.next")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/previous-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prev-message")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/message-previous")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.message.previous")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/page-up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.page_up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.page.up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/page-down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.page_down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.page.down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/half-page-up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.half.page.up")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/half-page-down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.half.page.down")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/line-up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.line_up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.line.up")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/line-down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/messages.line_down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.line.down")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/editor")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.editor")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-editor")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/editor-context-clear")).toBe(
      true
    )
    expect(
      isReservedBuiltinSlashCommandName("/prompt.editor_context.clear")
    ).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/prompt-editor-context-clear")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/add-selection")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/context.addSelection")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/selection-context")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/exit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/quit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/q")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.exit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app-exit")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/warp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.set")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace-set")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.open")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.current")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.update")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project.previous")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.new")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/worktree.create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.remove")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/workspace.reset")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/org")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/organization")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/orgs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/switch-org")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/console.org.switch")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/console-org-switch")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/tui")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/tui-config")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/keybinds")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/keybindings")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/init")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/review")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project-commands")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/command.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project-rules")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/refs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project-formatters")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/formatter.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/format")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/formatter.run")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/language-servers")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/lsp.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.lsp.diagnostics")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/debug-lsp-diagnostics")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/debug.lsp.symbols")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-lsp-symbols")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/debug.lsp.document-symbols")
    ).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/debug-lsp-document-symbols")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project-permissions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/approvals")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permission-list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permission.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permissions-pending")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/permission.prompt.fullscreen")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permission-fullscreen")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/approve")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permission-approve")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/deny")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/reject")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/permission-deny")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/questions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/question.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/answer")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/question.reply")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/reject-question")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/question.reject")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/todos")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/todo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.todo")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session-status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/thread-status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.get")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/v2.session.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.children")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.messages")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/v2.session.messages")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.revert")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.unrevert")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.abort")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.update")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.init")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/vcs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/vcs.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/vcs.diff")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/vcs.diff.raw")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/find")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/find.text")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/find.file")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/find.symbol")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/project-config")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/config.get")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/config.providers")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.login")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.logout")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-parity")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-cli")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.commands")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-http")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.api")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-gaps")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.missing")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-sync")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/sync.history.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-workspace")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/experimental.workspace.warp")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/betterc0de-lifecycle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/global.dispose")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/tui-control")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/tui.control.next")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-resources")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/experimental.resource.list")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/betterc0de-tui")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.thread")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-ui")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-run")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.run")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-serve")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.serve")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-attach")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.attach")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/attach")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/server.switch")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-web")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.web")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-acp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.acp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/acp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-upgrade")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.upgrade")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-uninstall")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.uninstall")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-generate")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.generate")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-completion")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.completion")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/completion")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-db")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de.db")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-db-path")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-db-migrate")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/db")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/db.migrate")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/db-query")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-providers")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-plugins")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plugin-install")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plugin")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plug")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plugin.install")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plugins.install")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/dialog.plugins.install")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/plugin-toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/plugins.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/betterc0de-tools")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcps")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.ls")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-auth")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.auth")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.auth.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.auth.ls")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-auth-list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-add")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.add")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-logout")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.logout")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-debug")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.debug")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/dialog.mcp.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/stats")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.stats")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/usage")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-info")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.info")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-paths")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.paths")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/db.path")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/paths")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-rg")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.rg.search")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.file.read")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-file-read")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.file.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-file-list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.file.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-file-status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.file.tree")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/file")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/file.read")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/file.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/file.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-snapshot")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.snapshot")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.snapshot.track")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/debug.snapshot.patch")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/debug.snapshot.diff")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug-utility")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.startup")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.scrap")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.v2")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.wait")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.status")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-mcp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.connect")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp.disconnect")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/dialog-mcp-toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-enable")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/mcp-disable")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt.skills")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/prompt-skills")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.skill")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.skills")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.agent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.agents")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent-create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agent.create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/agents.create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/create-agent")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.lsp")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/debug.config")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.dialog.provider")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/model-dialog-provider")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/timestamps")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-timestamps")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle.timestamps")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/session.toggle.timestamps")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/thinking")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-thinking")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle.thinking")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.toggle.thinking")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/reasoning-summaries")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/session.toggle.reasoning_summaries")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/tool-details")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/actions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-actions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle.actions")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.toggle.actions")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/progress")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session-progress")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/session.toggle.progress_bar")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/shell-expanded")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName(
        "/session.toggle.shell_tool_parts_expanded"
      )
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/edit-expanded")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName(
        "/session.toggle.edit_tool_parts_expanded"
      )
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/scrollbar")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-scrollbar")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle.scrollbar")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.toggle.scrollbar")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/generic-tool-output")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/generic-output")).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/toggle-generic-tool-output")
    ).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/toggle.generic_tool_output")
    ).toBe(true)
    expect(
      isReservedBuiltinSlashCommandName("/session.toggle.generic_tool_output")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/conceal")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-conceal")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.toggle.conceal")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/sidebar")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/toggle-sidebar")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.sidebar.toggle")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/app.console")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app-console")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.log")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app-log")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.set")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth-set")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.remove")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth-remove")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/heap-snapshot")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.heap_snapshot")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app-heap-snapshot")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/terminal-title")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/terminal.title.toggle")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/terminal-title-toggle")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/terminal-new")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/terminal.new")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/new-terminal")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.shells")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.create")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.get")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.update")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pty.connect")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/review.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/fileTree.toggle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/input.focus")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/animations")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.toggle.animations")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/file-context")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.toggle.file_context")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/paste-summary")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.toggle.paste_summary")).toBe(
      true
    )
    expect(isReservedBuiltinSlashCommandName("/session-directory-filter")).toBe(
      true
    )
    expect(
      isReservedBuiltinSlashCommandName("/app.toggle.session_directory_filter")
    ).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/summarize")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/session.compact")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/catalog")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/catalog.model.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/catalog.model.get")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/models.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/variant.cycle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/model.variant.cycle")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/theme-mode")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/theme.switch_mode")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/theme-mode-lock")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/theme.mode.lock")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/auth.ls")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/provider-auth")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/provider.auth")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/providers.list")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/providers.ls")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/providers.login")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/providers.logout")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/account")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/account.login")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/account.logout")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/account.orgs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/console.orgs")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/console.switch")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/pr")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/github.pr")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/github.install")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/github.run")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("compact-ui")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/app.toggle.diffwrap")).toBe(true)
    expect(isReservedBuiltinSlashCommandName("/provider-review")).toBe(false)
  })

  it("reserves BetterC0de session action ids as slash aliases", () => {
    const betterC0deSessionActionIds = [
      "session.share",
      "session.unshare",
      "session.new",
      "session.undo",
      "session.redo",
      "session.compact",
      "session.fork",
      "file.open",
      "tab.close",
      "context.addSelection",
      "terminal.toggle",
      "review.toggle",
      "fileTree.toggle",
      "input.focus",
      "terminal.new",
      "message.previous",
      "message.next",
      "model.choose",
      "model.variant.cycle",
      "mcp.toggle",
      "agent.cycle",
      "agent.cycle.reverse",
      "permissions.autoaccept",
    ]

    expect(
      betterC0deSessionActionIds.filter(
        (id) => !isReservedBuiltinSlashCommandName(`/${id}`)
      )
    ).toEqual([])
  })

  it("hides share commands when BetterC0de project sharing is disabled", () => {
    expect(
      filterBuiltinCommandsForBetterC0deShareMode(
        BUILTIN_COMMANDS,
        "disabled"
      ).map((command) => command.name)
    ).not.toEqual(expect.arrayContaining(["/share", "/unshare"]))
    expect(
      filterBuiltinCommandsForBetterC0deShareMode(BUILTIN_COMMANDS, "manual").map(
        (command) => command.name
      )
    ).toEqual(expect.arrayContaining(["/share", "/unshare"]))
  })

  it("exposes project skills as BetterC0de-style slash commands without shadowing commands", () => {
    expect(
      projectSkillSlashCommands(
        [
          {
            id: "frontend",
            name: "frontend",
            description: "Frontend implementation rules",
            sourcePath: ".betterc0de/skills/frontend/SKILL.md",
            content: "Use frontend rules",
          },
          {
            id: "review",
            name: "review",
            sourcePath: ".betterc0de/skills/review/SKILL.md",
            content: "Review rules",
          },
          {
            id: "deploy",
            name: "deploy",
            sourcePath: ".betterc0de/skills/deploy/SKILL.md",
            content: "Deploy rules",
          },
        ],
        [
          {
            name: "deploy",
            sourcePath: ".betterc0de/commands/deploy.md",
            template: "Deploy command",
          },
        ]
      ).map((command) => command.name)
    ).toEqual(["/frontend"])
  })

  it("shows BetterC0de project command agent/model/subtask metadata", () => {
    expect(
      projectCommandSlashCommands([
        {
          name: "deploy",
          description: "Deploy current branch",
          agent: "build",
          model: "anthropic/claude-sonnet-4-5",
          subtask: true,
          sourcePath: ".betterc0de/commands/deploy.md",
          template: "Deploy $ARGUMENTS",
        },
      ])[0]?.description
    ).toBe(
      "Deploy current branch (agent: build, model: anthropic/claude-sonnet-4-5, subtask: enabled)"
    )
  })

  it("reserves every BetterC0de composer input action as a slash alias", () => {
    expect(
      BETTERC0DE_INPUT_ACTION_COMMANDS.filter(
        (command) => !isReservedBuiltinSlashCommandName(`/${command}`)
      )
    ).toEqual([])
  })
})

describe("replaceSlashCommandTriggerRange", () => {
  it("replaces only the active provider skill token", () => {
    const text = "Use $gh-fi for this PR"

    expect(
      replaceSlashCommandTriggerRange(
        text,
        {
          start: "Use ".length,
          end: "Use $gh-fi".length,
        },
        "$gh-fix-ci "
      )
    ).toEqual({
      text: "Use $gh-fix-ci for this PR",
      cursor: "Use $gh-fix-ci ".length,
    })
  })

  it("replaces only the active provider slash command token", () => {
    const text = "First line\n/rev this PR"

    expect(
      replaceSlashCommandTriggerRange(
        text,
        {
          start: "First line\n".length,
          end: "First line\n/rev".length,
        },
        "/review "
      )
    ).toEqual({
      text: "First line\n/review this PR",
      cursor: "First line\n/review ".length,
    })
  })

  it("does not clobber the prompt when the active range is unavailable", () => {
    expect(
      replaceSlashCommandTriggerRange("Keep this prompt", null, "$imagegen ")
    ).toBeNull()
  })
})

describe("slashCommandSelectionReplacement", () => {
  it("executes model and mode slash commands without inserting text", () => {
    for (const command of BUILTIN_COMMANDS.filter((entry) =>
      ["model", "plan", "ask", "security", "debug", "default"].includes(
        entry.id
      )
    )) {
      expect(slashCommandSelectionReplacement(command)).toBe("")
    }
  })

  it("keeps chat-executed built-in commands as composer tokens", () => {
    expect(
      slashCommandSelectionReplacement({
        id: "status",
        name: "/status",
        description: "Show system status overview",
        category: "builtin",
        action: "execute",
      })
    ).toBe("/status ")
    expect(
      slashCommandSelectionReplacement({
        id: "settings",
        name: "/settings",
        description: "Open settings",
        category: "builtin",
        action: "execute",
      })
    ).toBe("/settings ")
  })

  it("keeps provider slash commands and skills as native composer tokens", () => {
    expect(
      slashCommandSelectionReplacement({
        id: "provider-review",
        name: "/review",
        description: "Review a pull request",
        category: "provider",
        action: "insert",
      })
    ).toBe("/review ")
    expect(
      slashCommandSelectionReplacement({
        id: "skill-gh-fix-ci",
        name: "$gh-fix-ci",
        description: "Fix GitHub Actions failures",
        category: "skill",
        action: "insert",
      })
    ).toBe("$gh-fix-ci ")
  })
})

describe("slashCommandEmptyStateText", () => {
  it("uses BetterC0de's provider skill empty-state copy", () => {
    expect(slashCommandEmptyStateText("$")).toBe(
      "No skills found. Try / to browse provider commands."
    )
  })

  it("keeps slash command misses distinct from provider skills", () => {
    expect(slashCommandEmptyStateText("/")).toBe("No matching command or skill.")
    expect(slashCommandEmptyStateText("/", "commands")).toBe("No matching command.")
    expect(slashCommandEmptyStateText("/", "skills")).toBe("No matching skills.")
  })
})

describe("skills in the slash menu", () => {
  const skills = providerSkillCommands([
    { name: "seo-audit", path: "/skills/seo-audit/SKILL.md", enabled: true, description: "Search visibility" },
    { name: "plan", path: "/skills/plan/SKILL.md", enabled: true },
    { name: "hidden-skill", path: "/skills/hidden/SKILL.md", enabled: false },
  ], "/")
  const commands = [...BUILTIN_COMMANDS, ...skills]

  it("shows skills immediately alongside built-ins and keeps a dedicated skill filter", () => {
    const preview = filterComposerCommands(commands, "")
    expect(preview).toHaveLength(12)
    expect(preview.map(command => command.id)).toContain("model")
    expect(preview.map(command => command.id)).toContain("skill-seo-audit")
    expect(filterComposerCommands(commands, "", "skills")).toEqual(skills)
    expect(filterComposerCommands(commands, "", "commands").every(command => command.category !== "skill")).toBe(true)
    expect(skills.some(command => command.name === "/hidden-skill")).toBe(false)
  })

  it("searches skill names and inserts the native token without losing surrounding text", () => {
    const command = filterComposerCommands(commands, "seo-audit")[0]
    expect(command.name).toBe("/seo-audit")
    const replacement = slashCommandSelectionReplacement(command)
    expect(replacement).toBe("$seo-audit ")
    expect(replaceSlashCommandTriggerRange("/seo check this page", { start: 0, end: 4 }, replacement)?.text).toBe("$seo-audit check this page")
  })

  it("distinguishes colliding skill selections from immediate built-in actions", () => {
    const matches = filterComposerCommands(commands, "plan")
    expect(matches[0].id).toBe("plan")
    const skill = matches.find(command => command.id === "skill-plan")!
    expect(slashCommandSelectionReplacement(skill)).toBe("$plan ")
    expect(slashCommandSelectionReplacement(matches[0])).toBe("")
  })
})
