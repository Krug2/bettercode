export type BetterC0deParityStatus =
  | "implemented"
  | "partial"
  | "native"
  | "display-only"

export interface BetterC0deParityArea {
  id: string
  area: string
  status: BetterC0deParityStatus
  settings: string
  chat: string
  evidence: string
  notes: string
}

export interface BetterC0deCliEntrypoint {
  chat: string
  cli: string
  status: BetterC0deParityStatus
  notes: string
}

export interface BetterC0deHttpOperation {
  id: string
  method: string
  path: string
  chat: string
  status: BetterC0deParityStatus
  notes: string
}

export interface BetterC0deGapRow {
  surface: "Feature area" | "CLI" | "HTTP/API"
  id: string
  entry: string
  access: string
  status: Extract<BetterC0deParityStatus, "partial" | "display-only">
  notes: string
}

export const BETTERC0DE_CLI_ENTRYPOINTS: BetterC0deCliEntrypoint[] = [
  {
    chat: "/betterc0de-cli",
    cli: "betterc0de --help",
    status: "implemented",
    notes: "Command-by-command BetterC0de mapping audit.",
  },
  {
    chat: "/betterc0de-tui",
    cli: "betterc0de [project]",
    status: "implemented",
    notes: "Default BetterC0de terminal UI compatibility handoff.",
  },
  {
    chat: "/betterc0de-run",
    cli: "betterc0de run [message..]",
    status: "implemented",
    notes: "Run guidance, validation, and terminal prefill.",
  },
  {
    chat: "/betterc0de-attach",
    cli: "betterc0de attach <url>",
    status: "implemented",
    notes: "Server attach guidance and URL validation.",
  },
  {
    chat: "/betterc0de-serve",
    cli: "betterc0de serve",
    status: "implemented",
    notes: "Server guidance with network flag validation.",
  },
  {
    chat: "/betterc0de-web",
    cli: "betterc0de web",
    status: "implemented",
    notes: "Web UI server guidance.",
  },
  {
    chat: "/betterc0de-acp",
    cli: "betterc0de acp",
    status: "implemented",
    notes: "ACP bridge guidance and terminal prefill.",
  },
  {
    chat: "/models",
    cli: "betterc0de models [provider]",
    status: "implemented",
    notes: "Provider/model catalog with verbose, refresh, and terminal handoff.",
  },
  {
    chat: "/providers.list",
    cli: "betterc0de providers list",
    status: "implemented",
    notes: "Provider auth/status listing.",
  },
  {
    chat: "/providers.ls",
    cli: "betterc0de providers ls",
    status: "implemented",
    notes: "BetterC0de compatibility providers list alias.",
  },
  {
    chat: "/auth.list",
    cli: "betterc0de auth list",
    status: "implemented",
    notes: "BetterC0de compatibility providers command alias for credential listing.",
  },
  {
    chat: "/auth.ls",
    cli: "betterc0de auth ls",
    status: "implemented",
    notes: "BetterC0de compatibility providers command alias plus list shorthand.",
  },
  {
    chat: "/providers.login",
    cli: "betterc0de providers login [url]",
    status: "implemented",
    notes: "Provider, method, and well-known login guidance.",
  },
  {
    chat: "/auth.login",
    cli: "betterc0de auth login [url]",
    status: "implemented",
    notes: "BetterC0de compatibility providers command alias for provider login.",
  },
  {
    chat: "/providers.logout",
    cli: "betterc0de providers logout",
    status: "implemented",
    notes: "Logout guidance and terminal handoff.",
  },
  {
    chat: "/auth.logout",
    cli: "betterc0de auth logout",
    status: "implemented",
    notes: "BetterC0de compatibility providers command alias for provider logout.",
  },
  {
    chat: "/console.login",
    cli: "betterc0de console login <url>",
    status: "implemented",
    notes: "Console login URL validation and terminal handoff.",
  },
  {
    chat: "/console.logout",
    cli: "betterc0de console logout [email]",
    status: "implemented",
    notes: "Console logout guidance.",
  },
  {
    chat: "/console.orgs",
    cli: "betterc0de console orgs",
    status: "implemented",
    notes: "Organization listing guidance.",
  },
  {
    chat: "/console.switch",
    cli: "betterc0de console switch",
    status: "implemented",
    notes: "Organization switch guidance.",
  },
  {
    chat: "/console.open",
    cli: "betterc0de console open",
    status: "implemented",
    notes: "Open active console account.",
  },
  {
    chat: "/account.login",
    cli: "betterc0de console login <url>",
    status: "implemented",
    notes: "BetterC0de account aliases map to BetterC0de console account commands.",
  },
  {
    chat: "/account.logout",
    cli: "betterc0de console logout [email]",
    status: "implemented",
    notes: "BetterC0de account aliases map to BetterC0de console account commands.",
  },
  {
    chat: "/account.orgs",
    cli: "betterc0de console orgs",
    status: "implemented",
    notes: "BetterC0de account aliases map to BetterC0de console account commands.",
  },
  {
    chat: "/account.switch",
    cli: "betterc0de console switch",
    status: "implemented",
    notes: "BetterC0de account aliases map to BetterC0de console account commands.",
  },
  {
    chat: "/account.open",
    cli: "betterc0de console open",
    status: "implemented",
    notes: "BetterC0de account aliases map to BetterC0de console account commands.",
  },
  {
    chat: "/mcp",
    cli: "betterc0de mcp list",
    status: "implemented",
    notes: "MCP server listing and status.",
  },
  {
    chat: "/mcp.ls",
    cli: "betterc0de mcp ls",
    status: "implemented",
    notes: "BetterC0de MCP list alias.",
  },
  {
    chat: "/mcp-add",
    cli: "betterc0de mcp add",
    status: "implemented",
    notes: "Config-only writer plus raw terminal handoff.",
  },
  {
    chat: "/mcp-auth",
    cli: "betterc0de mcp auth [name]",
    status: "implemented",
    notes: "OAuth/auth status and auth-list visibility.",
  },
  {
    chat: "/mcp.auth.list",
    cli: "betterc0de mcp auth list",
    status: "implemented",
    notes: "Read-only OAuth-capable MCP auth status.",
  },
  {
    chat: "/mcp.auth.ls",
    cli: "betterc0de mcp auth ls",
    status: "implemented",
    notes: "BetterC0de MCP auth-list shorthand.",
  },
  {
    chat: "/mcp-logout",
    cli: "betterc0de mcp logout [name]",
    status: "implemented",
    notes: "Auth removal guidance.",
  },
  {
    chat: "/mcp-debug",
    cli: "betterc0de mcp debug <name>",
    status: "implemented",
    notes: "Debug handoff without auto-starting arbitrary MCP clients.",
  },
  {
    chat: "/agents",
    cli: "betterc0de agent list",
    status: "implemented",
    notes: "Runtime and project agents.",
  },
  {
    chat: "/agent-create",
    cli: "betterc0de agent create",
    status: "implemented",
    notes: "Schema-valid project agent writer and terminal handoff.",
  },
  {
    chat: "/debug.agent",
    cli: "betterc0de debug agent <name>",
    status: "implemented",
    notes: "Agent detail and safe tool/params handoff.",
  },
  {
    chat: "/skills",
    cli: "betterc0de debug skill",
    status: "implemented",
    notes: "Skill list plus debug.skill content view.",
  },
  {
    chat: "/debug.skill",
    cli: "betterc0de debug skill",
    status: "implemented",
    notes: "BetterC0de-compatible debug JSON/content view for installed skills.",
  },
  {
    chat: "/session list",
    cli: "betterc0de session list",
    status: "implemented",
    notes: "BetterC0de-compatible table/JSON session listing.",
  },
  {
    chat: "/session delete",
    cli: "betterc0de session delete <sessionID>",
    status: "implemented",
    notes: "Delete guidance and terminal prefill.",
  },
  {
    chat: "/export",
    cli: "betterc0de export [sessionID]",
    status: "implemented",
    notes: "Markdown and BetterC0de JSON export.",
  },
  {
    chat: "/import",
    cli: "betterc0de import <file>",
    status: "implemented",
    notes: "Local, URL, and share import support.",
  },
  {
    chat: "/stats",
    cli: "betterc0de stats",
    status: "implemented",
    notes: "Token, tool, model, project, and day filters.",
  },
  {
    chat: "/github.install",
    cli: "betterc0de github install",
    status: "partial",
    notes: "Workflow writer and safe terminal handoff; no GitHub app auto-install.",
  },
  {
    chat: "/github.run",
    cli: "betterc0de github run",
    status: "partial",
    notes: "Run guidance, env mapping, validation, and terminal handoff.",
  },
  {
    chat: "/pr",
    cli: "betterc0de pr <number>",
    status: "partial",
    notes: "PR review prompt and optional raw terminal flow.",
  },
  {
    chat: "/plugin-install",
    cli: "betterc0de plugin <module>",
    status: "partial",
    notes: "Config-only plugin entry writer and raw install handoff.",
  },
  {
    chat: "/plug",
    cli: "betterc0de plug <module>",
    status: "partial",
    notes: "BetterC0de plugin command alias; maps to the same safe install guidance.",
  },
  {
    chat: "/betterc0de-upgrade",
    cli: "betterc0de upgrade [target]",
    status: "partial",
    notes: "Maintenance guidance and terminal handoff.",
  },
  {
    chat: "/betterc0de-uninstall",
    cli: "betterc0de uninstall",
    status: "partial",
    notes: "Dry-run/flag validation and terminal handoff.",
  },
  {
    chat: "/betterc0de-generate",
    cli: "betterc0de generate",
    status: "partial",
    notes: "OpenAPI generation guidance.",
  },
  {
    chat: "/betterc0de-completion",
    cli: "betterc0de completion",
    status: "partial",
    notes: "Shell-specific install snippets, validation, and terminal handoff.",
  },
  {
    chat: "/betterc0de-db",
    cli: "betterc0de db [query] | path | migrate",
    status: "partial",
    notes:
      "Direct read-only path lookup plus query/migration guidance without running SQL from chat.",
  },
  {
    chat: "/debug-info",
    cli: "betterc0de debug info",
    status: "implemented",
    notes: "Runtime diagnostics.",
  },
  {
    chat: "/debug-paths",
    cli: "betterc0de debug paths",
    status: "implemented",
    notes: "Config/data/cache/log/database paths.",
  },
  {
    chat: "/debug.config",
    cli: "betterc0de debug config",
    status: "implemented",
    notes: "Project JSON preview plus raw resolved terminal output.",
  },
  {
    chat: "/debug.lsp",
    cli: "betterc0de debug lsp diagnostics | symbols | document-symbols",
    status: "partial",
    notes: "Local previews and terminal prefill for raw live LSP.",
  },
  {
    chat: "/debug-rg",
    cli: "betterc0de debug rg tree | files | search",
    status: "implemented",
    notes: "Read-only ripgrep diagnostics with limit/query/glob handling.",
  },
  {
    chat: "/debug.file.read",
    cli: "betterc0de debug file read | list | status | search | tree",
    status: "implemented",
    notes: "Read-only file diagnostics.",
  },
  {
    chat: "/debug-snapshot",
    cli: "betterc0de debug snapshot track | patch | diff",
    status: "partial",
    notes: "Checkpoint/snapshot diagnostics mapped to BetterC0de checkpoints.",
  },
  {
    chat: "/debug-startup",
    cli: "betterc0de debug startup",
    status: "implemented",
    notes: "Startup timing guidance.",
  },
  {
    chat: "/debug-scrap",
    cli: "betterc0de debug scrap",
    status: "implemented",
    notes: "Project-list diagnostics guidance.",
  },
  {
    chat: "/debug-v2",
    cli: "betterc0de debug v2",
    status: "implemented",
    notes: "Catalog/provider diagnostics guidance.",
  },
  {
    chat: "/debug-wait",
    cli: "betterc0de debug wait",
    status: "implemented",
    notes: "Debugger wait guidance without starting an infinite process.",
  },
]

export const BETTERC0DE_HTTP_OPERATIONS: BetterC0deHttpOperation[] = [
  {
    id: "app.agents",
    method: "GET",
    path: "/agent",
    chat: "/agents",
    status: "implemented",
    notes: "Project/global BetterC0de agents plus debug views.",
  },
  {
    id: "app.log",
    method: "POST",
    path: "/log",
    chat: "/app.log",
    status: "implemented",
    notes: "Local BetterC0de-compatible log payload preview/write guidance.",
  },
  {
    id: "app.skills",
    method: "GET",
    path: "/skill",
    chat: "/skills",
    status: "implemented",
    notes: "Local, global, provider-native, and BetterC0de compatibility runtime skills.",
  },
  {
    id: "auth.remove",
    method: "DELETE",
    path: "/auth/{providerID}",
    chat: "/auth.remove",
    status: "partial",
    notes: "Safe auth removal guidance; raw credential mutation is explicit.",
  },
  {
    id: "auth.set",
    method: "PUT",
    path: "/auth/{providerID}",
    chat: "/auth.set",
    status: "partial",
    notes: "Safe auth setup guidance and terminal handoff.",
  },
  {
    id: "command.list",
    method: "GET",
    path: "/command",
    chat: "/commands",
    status: "implemented",
    notes: "Project/global .betterc0de command templates and config commands.",
  },
  {
    id: "config.get",
    method: "GET",
    path: "/config",
    chat: "/config.get",
    status: "implemented",
    notes: "BetterC0de compatibility project/global config summary and debug JSON preview.",
  },
  {
    id: "config.providers",
    method: "GET",
    path: "/config/providers",
    chat: "/providers.list",
    status: "implemented",
    notes: "Provider config, auth status, and redacted env names.",
  },
  {
    id: "config.update",
    method: "PATCH",
    path: "/config",
    chat: "/config.update",
    status: "partial",
    notes: "Schema-aware config-only writes for safe BetterC0de fields.",
  },
  {
    id: "event.subscribe",
    method: "GET",
    path: "/event",
    chat: "/event.subscribe",
    status: "implemented",
    notes: "Local thread/provider event snapshot rather than long-lived SSE.",
  },
  {
    id: "experimental.console.get",
    method: "GET",
    path: "/experimental/console",
    chat: "/account.open",
    status: "partial",
    notes: "Console account guidance and terminal handoff.",
  },
  {
    id: "experimental.console.listOrgs",
    method: "GET",
    path: "/experimental/console/orgs",
    chat: "/account.orgs",
    status: "partial",
    notes: "Console org listing guidance and terminal handoff.",
  },
  {
    id: "experimental.console.switchOrg",
    method: "POST",
    path: "/experimental/console/switch",
    chat: "/account.switch",
    status: "partial",
    notes: "Console org switch validation and terminal handoff.",
  },
  {
    id: "experimental.resource.list",
    method: "GET",
    path: "/experimental/resource",
    chat: "/mcp-resources",
    status: "partial",
    notes:
      "Configured MCP resource providers are listed; raw listResources calls stay explicit.",
  },
  {
    id: "experimental.session.list",
    method: "GET",
    path: "/experimental/session",
    chat: "/session.list",
    status: "implemented",
    notes: "Session list/table and JSON-compatible views.",
  },
  {
    id: "experimental.workspace.adapter.list",
    method: "GET",
    path: "/experimental/workspace/adapter",
    chat: "/workspace-list",
    status: "partial",
    notes: "Workspace/worktree state is shown through BetterC0de workspace views.",
  },
  {
    id: "experimental.workspace.create",
    method: "POST",
    path: "/experimental/workspace",
    chat: "/workspace-new",
    status: "partial",
    notes: "Workspace creation uses BetterC0de worktree/project flows.",
  },
  {
    id: "experimental.workspace.list",
    method: "GET",
    path: "/experimental/workspace",
    chat: "/workspace-list",
    status: "implemented",
    notes: "Workspace and git worktree lists are visible from chat.",
  },
  {
    id: "experimental.workspace.remove",
    method: "DELETE",
    path: "/experimental/workspace/{id}",
    chat: "/workspace-remove",
    status: "partial",
    notes: "Removal is routed through explicit workspace/worktree actions.",
  },
  {
    id: "experimental.workspace.status",
    method: "GET",
    path: "/experimental/workspace/status",
    chat: "/workspace-list",
    status: "partial",
    notes: "Status is summarized through BetterC0de workspace state.",
  },
  {
    id: "experimental.workspace.syncList",
    method: "POST",
    path: "/experimental/workspace/sync-list",
    chat: "/betterc0de-workspace, /experimental.workspace.syncList",
    status: "partial",
    notes:
      "Local BetterC0de workspace/thread context is shown as adapter sync-list equivalent.",
  },
  {
    id: "experimental.workspace.warp",
    method: "POST",
    path: "/experimental/workspace/warp",
    chat: "/betterc0de-workspace, /experimental.workspace.warp",
    status: "partial",
    notes:
      "Warp payloads are validated and mapped to explicit workspace/resume flows.",
  },
  {
    id: "file.list",
    method: "GET",
    path: "/file",
    chat: "/file.list",
    status: "implemented",
    notes: "Read-only workspace file listing/debug tree.",
  },
  {
    id: "file.read",
    method: "GET",
    path: "/file/content",
    chat: "/file.read",
    status: "implemented",
    notes: "Read-only workspace file content preview.",
  },
  {
    id: "file.status",
    method: "GET",
    path: "/file/status",
    chat: "/file.status",
    status: "implemented",
    notes: "File status and VCS-aware diagnostics.",
  },
  {
    id: "find.files",
    method: "GET",
    path: "/find/file",
    chat: "/find.file",
    status: "implemented",
    notes: "Quick-open and ripgrep-backed file search.",
  },
  {
    id: "find.symbols",
    method: "GET",
    path: "/find/symbol",
    chat: "/find.symbol",
    status: "implemented",
    notes: "Open-editor workspace symbols and local symbol search.",
  },
  {
    id: "find.text",
    method: "GET",
    path: "/find",
    chat: "/find",
    status: "implemented",
    notes: "Ripgrep-backed text search with query/glob/limit handling.",
  },
  {
    id: "formatter.status",
    method: "GET",
    path: "/formatter",
    chat: "/formatters",
    status: "implemented",
    notes: "Formatter config/status and safe formatter execution preview.",
  },
  {
    id: "global.config.get",
    method: "GET",
    path: "/global/config",
    chat: "/global.config.get",
    status: "implemented",
    notes: "Global BetterC0de compatibility config source is read and summarized.",
  },
  {
    id: "global.config.update",
    method: "PATCH",
    path: "/global/config",
    chat: "/global.config.update",
    status: "partial",
    notes: "Safe config-only writes; secrets and arbitrary mutation stay explicit.",
  },
  {
    id: "global.dispose",
    method: "POST",
    path: "/global/dispose",
    chat: "/global.dispose",
    status: "partial",
    notes:
      "Dispose scope is surfaced with explicit BetterC0de lifecycle guidance.",
  },
  {
    id: "global.event",
    method: "GET",
    path: "/global/event",
    chat: "/events",
    status: "partial",
    notes: "Local event snapshot instead of BetterC0de global event stream.",
  },
  {
    id: "global.health",
    method: "GET",
    path: "/global/health",
    chat: "/global.health",
    status: "implemented",
    notes: "Runtime health/debug diagnostics.",
  },
  {
    id: "global.upgrade",
    method: "POST",
    path: "/global/upgrade",
    chat: "/betterc0de-upgrade",
    status: "partial",
    notes: "Upgrade guidance and terminal handoff with validation.",
  },
  {
    id: "instance.dispose",
    method: "POST",
    path: "/instance/dispose",
    chat: "/instance.dispose",
    status: "partial",
    notes:
      "Instance dispose is surfaced without silently killing Electron/provider state.",
  },
  {
    id: "lsp.status",
    method: "GET",
    path: "/lsp",
    chat: "/lsp",
    status: "implemented",
    notes: "Configured LSP servers, diagnostics, symbols, and JSON previews.",
  },
  {
    id: "mcp.add",
    method: "POST",
    path: "/mcp",
    chat: "/mcp-add",
    status: "partial",
    notes: "Config-only MCP writes plus terminal handoff.",
  },
  {
    id: "mcp.auth.authenticate",
    method: "POST",
    path: "/mcp/{name}/auth/authenticate",
    chat: "/mcp-auth",
    status: "partial",
    notes: "OAuth-capable MCP auth status and explicit auth guidance.",
  },
  {
    id: "mcp.auth.callback",
    method: "POST",
    path: "/mcp/{name}/auth/callback",
    chat: "/mcp.auth.start",
    status: "partial",
    notes: "Callback route is surfaced as explicit MCP auth guidance.",
  },
  {
    id: "mcp.auth.remove",
    method: "DELETE",
    path: "/mcp/{name}/auth",
    chat: "/mcp.auth.remove",
    status: "partial",
    notes: "MCP auth removal guidance; credentials are not silently deleted.",
  },
  {
    id: "mcp.auth.start",
    method: "POST",
    path: "/mcp/{name}/auth",
    chat: "/mcp.auth.start",
    status: "partial",
    notes: "MCP OAuth start guidance and terminal handoff.",
  },
  {
    id: "mcp.connect",
    method: "POST",
    path: "/mcp/{name}/connect",
    chat: "/mcp.connect",
    status: "partial",
    notes: "MCP connect route is visible; runtime connection stays provider-owned.",
  },
  {
    id: "mcp.disconnect",
    method: "POST",
    path: "/mcp/{name}/disconnect",
    chat: "/mcp.disconnect",
    status: "partial",
    notes: "MCP disconnect route is visible; runtime connection stays provider-owned.",
  },
  {
    id: "mcp.status",
    method: "GET",
    path: "/mcp",
    chat: "/mcp",
    status: "implemented",
    notes: "MCP server listing, enabled state, and auth status.",
  },
  {
    id: "part.delete",
    method: "DELETE",
    path: "/session/{sessionID}/message/{messageID}/part/{partID}",
    chat: "/part.delete",
    status: "partial",
    notes: "Part mutation route is documented; no hidden transcript edits.",
  },
  {
    id: "part.update",
    method: "PATCH",
    path: "/session/{sessionID}/message/{messageID}/part/{partID}",
    chat: "/part.update",
    status: "partial",
    notes: "Part update route is documented; transcript mutation remains explicit.",
  },
  {
    id: "path.get",
    method: "GET",
    path: "/path",
    chat: "/path.get",
    status: "implemented",
    notes: "BetterC0de compatibility config/data/cache/log/database path diagnostics.",
  },
  {
    id: "permission.list",
    method: "GET",
    path: "/permission",
    chat: "/permissions",
    status: "implemented",
    notes: "Project permission rules and pending approvals.",
  },
  {
    id: "permission.reply",
    method: "POST",
    path: "/permission/{requestID}/reply",
    chat: "/approve, /deny",
    status: "implemented",
    notes: "Approval decision routing for pending provider/tool requests.",
  },
  {
    id: "permission.respond",
    method: "POST",
    path: "/session/{sessionID}/permissions/{permissionID}",
    chat: "/approve, /deny",
    status: "implemented",
    notes: "Session-scoped approval response routing.",
  },
  {
    id: "project.current",
    method: "GET",
    path: "/project/current",
    chat: "/project.current",
    status: "implemented",
    notes: "Current workspace/project state.",
  },
  {
    id: "project.initGit",
    method: "POST",
    path: "/project/git/init",
    chat: "/project.initGit",
    status: "partial",
    notes:
      "Git init route has explicit chat guidance and `git init` terminal prefill; mutation remains user-confirmed.",
  },
  {
    id: "project.list",
    method: "GET",
    path: "/project",
    chat: "/project.list",
    status: "implemented",
    notes: "Known workspace/project list.",
  },
  {
    id: "project.update",
    method: "PATCH",
    path: "/project/{projectID}",
    chat: "/project.update",
    status: "partial",
    notes: "Project metadata updates remain explicit through BetterC0de project state.",
  },
  {
    id: "provider.auth",
    method: "GET",
    path: "/provider/auth",
    chat: "/auth",
    status: "implemented",
    notes: "Read-only auth.json/auth-v2.json credential status.",
  },
  {
    id: "provider.list",
    method: "GET",
    path: "/provider",
    chat: "/providers.list",
    status: "implemented",
    notes: "Provider and model catalog with auth/runtime status.",
  },
  {
    id: "provider.oauth.authorize",
    method: "POST",
    path: "/provider/{providerID}/oauth/authorize",
    chat: "/providers.login",
    status: "partial",
    notes: "OAuth provider login guidance and terminal handoff.",
  },
  {
    id: "provider.oauth.callback",
    method: "POST",
    path: "/provider/{providerID}/oauth/callback",
    chat: "/providers.login",
    status: "partial",
    notes: "OAuth callback route is surfaced but not silently handled from chat.",
  },
  {
    id: "pty.connect",
    method: "GET",
    path: "/pty/{ptyID}/connect",
    chat: "/pty.connect",
    status: "partial",
    notes: "Integrated terminal sessions use BetterC0de's PTY surface.",
  },
  {
    id: "pty.connectToken",
    method: "POST",
    path: "/pty/{ptyID}/connect-token",
    chat: "/pty.connect",
    status: "partial",
    notes: "PTY connection is local app-owned rather than token-proxied.",
  },
  {
    id: "pty.create",
    method: "POST",
    path: "/pty",
    chat: "/pty.create",
    status: "implemented",
    notes: "New integrated terminal session creation.",
  },
  {
    id: "pty.get",
    method: "GET",
    path: "/pty/{ptyID}",
    chat: "/pty.list",
    status: "partial",
    notes: "PTY details are available through terminal session list/state.",
  },
  {
    id: "pty.list",
    method: "GET",
    path: "/pty",
    chat: "/pty.list",
    status: "implemented",
    notes: "Terminal session listing.",
  },
  {
    id: "pty.remove",
    method: "DELETE",
    path: "/pty/{ptyID}",
    chat: "/pty.remove",
    status: "partial",
    notes: "Terminal lifecycle actions are explicit in the UI/terminal surface.",
  },
  {
    id: "pty.shells",
    method: "GET",
    path: "/pty/shells",
    chat: "/pty.shells",
    status: "implemented",
    notes: "Detected shell list and terminal launch guidance.",
  },
  {
    id: "pty.update",
    method: "PUT",
    path: "/pty/{ptyID}",
    chat: "/pty.update",
    status: "partial",
    notes: "PTY metadata updates remain terminal-surface owned.",
  },
  {
    id: "question.list",
    method: "GET",
    path: "/question",
    chat: "/questions",
    status: "implemented",
    notes: "Pending provider question requests.",
  },
  {
    id: "question.reject",
    method: "POST",
    path: "/question/{requestID}/reject",
    chat: "/reject-question",
    status: "implemented",
    notes: "Reject a pending provider question.",
  },
  {
    id: "question.reply",
    method: "POST",
    path: "/question/{requestID}/reply",
    chat: "/answer",
    status: "implemented",
    notes: "Reply to a pending provider question.",
  },
  {
    id: "session.abort",
    method: "POST",
    path: "/session/{sessionID}/abort",
    chat: "/interrupt",
    status: "implemented",
    notes: "Interrupt the active provider turn.",
  },
  {
    id: "session.children",
    method: "GET",
    path: "/session/{sessionID}/children",
    chat: "/session.children",
    status: "implemented",
    notes: "Fork tree and child session navigation.",
  },
  {
    id: "session.command",
    method: "POST",
    path: "/session/{sessionID}/command",
    chat: "/session.command",
    status: "partial",
    notes: "Internal route guidance; command execution stays explicit.",
  },
  {
    id: "session.create",
    method: "POST",
    path: "/session",
    chat: "/new",
    status: "implemented",
    notes: "Create a new BetterC0de chat session.",
  },
  {
    id: "session.delete",
    method: "DELETE",
    path: "/session/{sessionID}",
    chat: "/session delete",
    status: "implemented",
    notes: "Delete/archive session flows with explicit target.",
  },
  {
    id: "session.deleteMessage",
    method: "DELETE",
    path: "/session/{sessionID}/message/{messageID}",
    chat: "/session.deleteMessage",
    status: "partial",
    notes: "Message deletion route is documented; no hidden transcript mutation.",
  },
  {
    id: "session.diff",
    method: "GET",
    path: "/session/{sessionID}/diff",
    chat: "/session.diff",
    status: "implemented",
    notes: "Active session/worktree diff views.",
  },
  {
    id: "session.fork",
    method: "POST",
    path: "/session/{sessionID}/fork",
    chat: "/fork",
    status: "implemented",
    notes: "Thread fork and child navigation.",
  },
  {
    id: "session.get",
    method: "GET",
    path: "/session/{sessionID}",
    chat: "/session.get",
    status: "implemented",
    notes: "Session detail via session list/get views.",
  },
  {
    id: "session.init",
    method: "POST",
    path: "/session/{sessionID}/init",
    chat: "/init",
    status: "implemented",
    notes: "Repo-local instruction initialization.",
  },
  {
    id: "session.list",
    method: "GET",
    path: "/session",
    chat: "/sessions",
    status: "implemented",
    notes: "Session list, filters, resume, and JSON-compatible output.",
  },
  {
    id: "session.message",
    method: "GET",
    path: "/session/{sessionID}/message/{messageID}",
    chat: "/messages",
    status: "implemented",
    notes: "Message detail through transcript/message list views.",
  },
  {
    id: "session.messages",
    method: "GET",
    path: "/session/{sessionID}/message",
    chat: "/messages",
    status: "implemented",
    notes: "Paged session message listing.",
  },
  {
    id: "session.prompt",
    method: "POST",
    path: "/session/{sessionID}/message",
    chat: "/session.prompt",
    status: "partial",
    notes: "Prompt submission uses BetterC0de composer/runtime, with route visible.",
  },
  {
    id: "session.prompt_async",
    method: "POST",
    path: "/session/{sessionID}/prompt_async",
    chat: "/session.prompt_async",
    status: "partial",
    notes: "Async prompt route maps to explicit composer/runtime handling.",
  },
  {
    id: "session.revert",
    method: "POST",
    path: "/session/{sessionID}/revert",
    chat: "/session.revert",
    status: "implemented",
    notes: "Checkpoint restore/revert guidance.",
  },
  {
    id: "session.share",
    method: "POST",
    path: "/session/{sessionID}/share",
    chat: "/share",
    status: "implemented",
    notes: "Share policy gates and explicit share flow.",
  },
  {
    id: "session.shell",
    method: "POST",
    path: "/session/{sessionID}/shell",
    chat: "/session.shell",
    status: "partial",
    notes: "Shell actions require explicit terminal/approval flow.",
  },
  {
    id: "session.status",
    method: "GET",
    path: "/session/status",
    chat: "/session.status",
    status: "implemented",
    notes: "Active session status summary.",
  },
  {
    id: "session.summarize",
    method: "POST",
    path: "/session/{sessionID}/summarize",
    chat: "/compact",
    status: "implemented",
    notes: "Chat compaction/summarization.",
  },
  {
    id: "session.todo",
    method: "GET",
    path: "/session/{sessionID}/todo",
    chat: "/session.todo",
    status: "implemented",
    notes: "BetterC0de-compatible todo/task list.",
  },
  {
    id: "session.unrevert",
    method: "POST",
    path: "/session/{sessionID}/unrevert",
    chat: "/session.unrevert",
    status: "implemented",
    notes: "Checkpoint unrevert/redo guidance.",
  },
  {
    id: "session.unshare",
    method: "DELETE",
    path: "/session/{sessionID}/share",
    chat: "/unshare",
    status: "implemented",
    notes: "Explicit unshare flow.",
  },
  {
    id: "session.update",
    method: "PATCH",
    path: "/session/{sessionID}",
    chat: "/session.update",
    status: "implemented",
    notes: "Title/archive/unarchive/permission session updates.",
  },
  {
    id: "sync.history.list",
    method: "POST",
    path: "/sync/history",
    chat: "/betterc0de-sync, /sync.history.list",
    status: "partial",
    notes:
      "Local thread/activity events are exposed as a sync-compatible history snapshot.",
  },
  {
    id: "sync.replay",
    method: "POST",
    path: "/sync/replay",
    chat: "/betterc0de-sync, /sync.replay",
    status: "partial",
    notes:
      "Replay payloads are validated and routed to explicit import guidance.",
  },
  {
    id: "sync.start",
    method: "POST",
    path: "/sync/start",
    chat: "/betterc0de-sync, /sync.start",
    status: "partial",
    notes:
      "Workspace sync start maps to BetterC0de local session/workspace state.",
  },
  {
    id: "sync.steal",
    method: "POST",
    path: "/sync/steal",
    chat: "/betterc0de-sync, /sync.steal",
    status: "partial",
    notes:
      "Session steal payloads are validated and mapped to explicit resume/workspace flows.",
  },
  {
    id: "tool.ids",
    method: "GET",
    path: "/experimental/tool/ids",
    chat: "/tool.ids",
    status: "implemented",
    notes: "Project/BetterC0de tool IDs and plugin tool visibility.",
  },
  {
    id: "tool.list",
    method: "GET",
    path: "/experimental/tool",
    chat: "/tool.list",
    status: "implemented",
    notes: "Project/BetterC0de tool definitions and plugin tool visibility.",
  },
  {
    id: "tui.appendPrompt",
    method: "POST",
    path: "/tui/append-prompt",
    chat: "/tui.appendPrompt",
    status: "partial",
    notes: "Composer draft action is exposed through route guidance/keybinds.",
  },
  {
    id: "tui.clearPrompt",
    method: "POST",
    path: "/tui/clear-prompt",
    chat: "/tui.clearPrompt",
    status: "implemented",
    notes: "Composer clear action and keybind mapping.",
  },
  {
    id: "tui.control.next",
    method: "GET",
    path: "/tui/control/next",
    chat: "/tui.control.next",
    status: "partial",
    notes:
      "External TUI control queue state maps to BetterC0de UI/slash controls.",
  },
  {
    id: "tui.control.response",
    method: "POST",
    path: "/tui/control/response",
    chat: "/tui.control.response",
    status: "partial",
    notes:
      "Control response payloads are validated and mapped to UI event guidance.",
  },
  {
    id: "tui.executeCommand",
    method: "POST",
    path: "/tui/execute-command",
    chat: "/tui.executeCommand",
    status: "implemented",
    notes: "CommandMap ids route to slash aliases or Settings/keybind guidance.",
  },
  {
    id: "tui.openHelp",
    method: "POST",
    path: "/tui/open-help",
    chat: "/help",
    status: "implemented",
    notes: "Help command list and BetterC0de-compatible workflow rows.",
  },
  {
    id: "tui.openModels",
    method: "POST",
    path: "/tui/open-models",
    chat: "/models",
    status: "implemented",
    notes: "Model/provider catalog and picker-equivalent listing.",
  },
  {
    id: "tui.openSessions",
    method: "POST",
    path: "/tui/open-sessions",
    chat: "/sessions",
    status: "implemented",
    notes: "Session picker/list equivalent.",
  },
  {
    id: "tui.openThemes",
    method: "POST",
    path: "/tui/open-themes",
    chat: "/themes",
    status: "implemented",
    notes: "Theme list/switching surface.",
  },
  {
    id: "tui.publish",
    method: "POST",
    path: "/tui/publish",
    chat: "/tui.publish",
    status: "partial",
    notes:
      "BetterC0de terminal UI publish events are parsed and mapped to safe BetterC0de UI equivalents.",
  },
  {
    id: "tui.selectSession",
    method: "POST",
    path: "/tui/select-session",
    chat: "/tui.selectSession",
    status: "implemented",
    notes: "Session selection maps to BetterC0de resume/navigation.",
  },
  {
    id: "tui.showToast",
    method: "POST",
    path: "/tui/show-toast",
    chat: "/tui.showToast",
    status: "partial",
    notes: "Toast route is visible; UI notifications remain BetterC0de-owned.",
  },
  {
    id: "tui.submitPrompt",
    method: "POST",
    path: "/tui/submit-prompt",
    chat: "/tui.submitPrompt",
    status: "implemented",
    notes: "Prompt submit maps to composer submit behavior.",
  },
  {
    id: "v2.model.list",
    method: "GET",
    path: "/api/model",
    chat: "/models",
    status: "implemented",
    notes: "compatibility v2 model list equivalent.",
  },
  {
    id: "v2.provider.get",
    method: "GET",
    path: "/api/provider/{providerID}",
    chat: "/v2.provider.get",
    status: "implemented",
    notes: "Provider details through provider catalog/status views.",
  },
  {
    id: "v2.provider.list",
    method: "GET",
    path: "/api/provider",
    chat: "/v2.provider.list",
    status: "implemented",
    notes: "compatibility v2 provider list equivalent.",
  },
  {
    id: "v2.session.compact",
    method: "POST",
    path: "/api/session/{sessionID}/compact",
    chat: "/v2.session.compact",
    status: "implemented",
    notes: "Compact active chat/session context.",
  },
  {
    id: "v2.session.context",
    method: "GET",
    path: "/api/session/{sessionID}/context",
    chat: "/v2.session.context",
    status: "implemented",
    notes: "Inspect active chat context.",
  },
  {
    id: "v2.session.list",
    method: "GET",
    path: "/api/session",
    chat: "/v2.session.list",
    status: "implemented",
    notes: "compatibility v2 session list equivalent.",
  },
  {
    id: "v2.session.messages",
    method: "GET",
    path: "/api/session/{sessionID}/message",
    chat: "/v2.session.messages",
    status: "implemented",
    notes: "compatibility v2 session message list equivalent.",
  },
  {
    id: "v2.session.prompt",
    method: "POST",
    path: "/api/session/{sessionID}/prompt",
    chat: "/v2.session.prompt",
    status: "partial",
    notes: "Prompt route maps to BetterC0de composer/runtime handling.",
  },
  {
    id: "v2.session.wait",
    method: "POST",
    path: "/api/session/{sessionID}/wait",
    chat: "/v2.session.wait",
    status: "partial",
    notes: "Wait route is visible; BetterC0de uses provider stream state.",
  },
  {
    id: "vcs.apply",
    method: "POST",
    path: "/vcs/apply",
    chat: "/vcs.apply",
    status: "partial",
    notes: "Reviewed patch/apply guidance; no blind VCS mutation from chat.",
  },
  {
    id: "vcs.diff",
    method: "GET",
    path: "/vcs/diff",
    chat: "/vcs.diff",
    status: "implemented",
    notes: "Structured VCS diff view.",
  },
  {
    id: "vcs.diff.raw",
    method: "GET",
    path: "/vcs/diff/raw",
    chat: "/vcs.diff.raw",
    status: "implemented",
    notes: "Raw VCS diff view.",
  },
  {
    id: "vcs.get",
    method: "GET",
    path: "/vcs",
    chat: "/vcs.get",
    status: "implemented",
    notes: "VCS repository summary.",
  },
  {
    id: "vcs.status",
    method: "GET",
    path: "/vcs/status",
    chat: "/vcs.status",
    status: "implemented",
    notes: "Git status summary.",
  },
  {
    id: "worktree.create",
    method: "POST",
    path: "/experimental/worktree",
    chat: "/worktree.create",
    status: "partial",
    notes: "Worktree creation uses BetterC0de project/worktree flows.",
  },
  {
    id: "worktree.list",
    method: "GET",
    path: "/experimental/worktree",
    chat: "/worktree.list",
    status: "implemented",
    notes: "Git worktree listing.",
  },
  {
    id: "worktree.remove",
    method: "DELETE",
    path: "/experimental/worktree",
    chat: "/worktree.remove",
    status: "partial",
    notes: "Worktree removal requires explicit target/action.",
  },
  {
    id: "worktree.reset",
    method: "POST",
    path: "/experimental/worktree/reset",
    chat: "/worktree.reset",
    status: "partial",
    notes: "Worktree reset is explicit and guarded by BetterC0de state.",
  },
]

export const BETTERC0DE_PARITY_AREAS: BetterC0deParityArea[] = [
  {
    id: "command-map",
    area: "TUI CommandMap",
    status: "implemented",
    settings: "Settings > Compatibility > BetterC0de Default Keybinds",
    chat: "/keybinds, /input-actions, /prompt.clear, /prompt.paste, /prompt.submit, /approvals, /workspace-new, /workspace-list, /workspace-remove, /workspace-reset, /worktree.create, /project.current, /project.list, /project-next, /pty.list, /pty.create, /language, /betterc0de-api",
    evidence:
      "BetterC0de CommandMap names, app layout command ids, direct keybind names, and selected HTTP route identifiers are represented as slash aliases or keybind references, including input.* composer actions, dialog.select.*, prompt.autocomplete.*, prompt.clear/paste/submit, permission prompt fullscreen, model/provider dialogs, session/project/workspace navigation, worktree create/list/removal/reset, PTY terminal list/shell/create/connect aliases, theme switching/mode lock, language compatibility actions, terminal title toggle, MCP dialog toggle, plugin install/toggle actions, catalog-driven `tui.command.execute` routing for BetterC0de keybind command ids, a full BetterC0de API operation matrix via `/betterc0de-api`, and explicit native/Settings guidance for keybind-only command ids.",
    notes:
      "Non-action text input commands are surfaced through composer keybind rows.",
  },
  {
    id: "composer-input",
    area: "Composer input keybinds",
    status: "native",
    settings: "Settings > Compatibility > BetterC0de Composer Keybinds",
    chat: "/keybinds",
    evidence:
      "Return submits, BetterC0de newline variants insert newlines, prompt history uses up/down at boundaries, and line-edit shortcuts are handled by the composer.",
    notes:
      "Cursor movement, selection, undo, redo, paste, and word navigation use native textarea behavior.",
  },
  {
    id: "project-config",
    area: "betterc0de.json / tui.json",
    status: "implemented",
    settings: "Settings > Compatibility > Config Settings / TUI & Keybinds",
    chat: "/betterc0de-config, /config.update, /global.config.get, /global.config.update, /tui, /keybinds",
    evidence:
      "BetterC0de reads global ~/.config/betterc0de config, BETTERC0DE_CONFIG, BETTERC0DE_CONFIG_CONTENT, BETTERC0DE_PERMISSION, BETTERC0DE_TUI_CONFIG, BETTERC0DE_DISABLE_PROJECT_CONFIG, BETTERC0DE_DISABLE_CLAUDE_CODE_PROMPT, managed BetterC0de compatibility config directories and macOS mobileconfig managed preferences, betterc0de.json/betterc0de.jsonc and tui.json/tui.jsonc up to the git root, plus parent/home .betterc0de config files. Safe BetterC0de terminal UI fields and keybind overrides are writable from chat with `/tui --config-only` and `/keybinds --config-only`, including the compatibility source's legacy nested tui.json `tui` object flattening; BetterC0de `$schema` is preserved or inserted on project betterc0de.json writes; direct config.get and config.providers aliases route to the existing config/provider views.",
    notes: "Deprecated TUI keys are displayed through the TUI group.",
  },
  {
    id: "provider-policy",
    area: "Provider policy and models",
    status: "partial",
    settings: "Settings > Compatibility > Provider Policy / Project Providers",
    chat: "/project-providers, /models, /models <query> --verbose, /catalog, /providers.list, /providers.login, /providers.logout, /account.login, /account.logout, /account.orgs, /console.orgs, /account.switch, /console.switch, /account.open, /auth",
    evidence:
      "enabled_providers, disabled_providers, model, small_model, provider blocks, provider upstream id, model overrides, model API id, schema-valid custom model metadata/status/capability/interleaved/limit/modality/provider-runtime/cost/>200k-cost/variant writes including required limit and modality pairs, variants, explicit config-only non-secret project provider writes with missing-value, id/list, status, modality, numeric, key=value pair, boolean, interleaved, and env-name validation before file writes, safe provider options (baseURL, enterpriseUrl, setCacheKey, timeout, chunkTimeout, custom provider options, model options, model headers), top-level provider policy writes, per-provider model whitelist/blacklist filtering for runtime snapshots, model endpoints, project-model picker promotion, and send-turn enforcement, BetterC0de compatibility providers.list/providers.ls/login/logout aliases, Compatibility `betterc0de auth` CLI alias rows, BetterC0de-compatible `/providers login|list|logout`, `/auth login|list|logout`, and direct `/auth.login|/auth.logout` subcommands, account.login/logout/orgs/switch/open aliases, BetterC0de-compatible `/console login|logout|switch|orgs|open` and `/account login|logout|switch|orgs|open` subcommands, auth.set/auth.remove safe control-route guidance, --terminal prefills for provider/console auth including plugin auth --method, inline provider/method/url argument validation, providers list/logout no-argument validation, console orgs/switch/open no-argument validation, compatibility-specific login notes for well-known compatibility providers, Vercel, Cloudflare, Bedrock, and Other/custom provider flows, org switch, exact no-argument account open, and well-known URL flows, betterc0de models commands, redacted provider environment variable names, models CLI-style catalog listing with verbose/refresh flags, exact BetterC0de compatibility provider filtering, provider/boolean flag validation, explicit provider-not-found diagnostics, and read-only auth.json/auth-v2.json credential status are visible; BetterC0de default and project provider models are promoted for the BetterC0de compatibility provider.",
    notes:
      "Arbitrary BetterC0de custom provider execution remains delegated to the BetterC0de compatibility runtime provider.",
  },
  {
    id: "agents-skills-commands",
    area: "Agents, skills, and commands",
    status: "implemented",
    settings: "Settings > Compatibility > Agents & Skills / Commands",
    chat: "/agents, /agent-create, /debug.agent, /skills, /debug.skill, /commands",
    evidence:
      "Project, global, parent .betterc0de, and home .betterc0de compatibility commands, direct command.list alias, config-only command writes, agents, BetterC0de-compatible app.agents/agent list/debug details, debug.agent --tool/--params safe terminal handoff, BetterC0de-compatible `/agent list|create|debug` subcommands, --terminal prefills for raw agent list/create/debug commands, non-interactive project agent creation with schema-valid provider/model, variant, temperature, top_p, color, steps, hidden, and prompt frontmatter validation, debug.agent aliases, agent permissions, BetterC0de built-in customize-betterc0de skill with disk override behavior, local skills, global skills, compatibility external skill disable flags, app.skills/debug.skill aliases, BetterC0de-compatible `/skills --verbose` available_skills output, `betterc0de debug skill` JSON output, provider-native skills, $skill insertion, and config-only compatibility skills.paths/skills.urls writes are surfaced.",
    notes:
      "Provider-specific native slash commands remain routed to provider runtimes.",
  },
  {
    id: "mcp-references",
    area: "MCP, references, and instructions",
    status: "implemented",
    settings: "Settings > Compatibility > MCP & References",
    chat: "/mcps, /mcp-resources, /mcp-add, /mcp-auth, /mcp-logout, /mcp-debug, /mcp.auth.list, /mcp.auth.start, /mcp.auth.remove, /references, /instructions",
    evidence:
      "Local and remote MCP definitions including timeout, OAuth config, BetterC0de mcp list/ls/status/add/auth/logout/debug/connect/disconnect entrypoints, BetterC0de-compatible `/mcp add|auth|logout|debug|list|resources` subcommands, --terminal prefills for raw BetterC0de MCP CLI/server flows, config-only project MCP writes and enable/disable overrides with type/env/header/oauth/enabled/timeout validation before writes, BetterC0de experimental.resource.list-style configured MCP resource-provider visibility, BetterC0de mcp.auth.list/mcp.auth.ls-style read-only mcp-auth.json auth status, BetterC0de reference aliases including external local paths, default AGENTS.md/CLAUDE.md/CONTEXT.md instructions with BETTERC0DE_DISABLE_PROJECT_CONFIG and BETTERC0DE_DISABLE_CLAUDE_CODE_PROMPT behavior, configured instruction files/URLs, and config-only reference/instruction writes are parsed and displayed.",
    notes:
      "Project-local MCP enable/disable follows the project config source.",
  },
  {
    id: "formatters-lsp",
    area: "Formatters and LSP",
    status: "partial",
    settings: "Settings > Compatibility > Formatters & LSP",
    chat: "/formatters, /format, /lsp, /lsp diagnostics <file>, /lsp symbols <query>, /lsp document-symbols <uri>",
    evidence:
      "Formatter config is listed, safely writable with /formatters --config-only including formatter=true/false built-in mode, object-mode built-ins with BetterC0de-compatible overrides/deletes including linked ruff/uv disabling, missing-value/boolean/env/extension validation before writes, BetterC0de-compatible formatter.status availability reporting, and executable when a command or supported BetterC0de built-in formatter is available with BetterC0de-compatible package/config activation gates for prettier, oxfmt, biome, clang-format, ruff, air, uv, and pint; /format supports dry-run and terminal preview of the resolved formatter command; lsp=true expands to concrete BetterC0de built-in LSP entries with the compatibility source's ty/pyright experimental filtering; LSP config is listed and safely writable with /lsp --config-only including lsp=true/false built-in mode, object-mode built-ins with BetterC0de-compatible overrides/deletes, missing-value/boolean/env/init/extension validation, schema-valid command requirements, and custom-server --ext enforcement while allowing BetterC0de built-in overrides; lsp.status and BetterC0de debug lsp diagnostics/symbols/document-symbols entrypoints are reachable from chat with configured server matching, cached Monaco diagnostics, open-editor workspace symbols, document outline symbols, --json BetterC0de-compatible previews, and --terminal prefills for raw BetterC0de LSP debug commands.",
    notes:
      "Built-in BetterC0de formatter execution is best-effort; raw live BetterC0de LSP JSON still remains delegated to the active provider/BetterC0de compatibility runtime.",
  },
  {
    id: "permissions-approvals",
    area: "Permissions, approvals, and questions",
    status: "implemented",
    settings: "Settings > Compatibility > Permissions / Agent Permissions",
    chat: "/permissions, /approvals, /approve, /deny, /questions, /answer, /reject-question, /question.reject",
    evidence:
      "Project permission rules, agent-scoped rules, BetterC0de legacy tool-flag permissions including repo_clone/repo_overview/external_directory, explicit config-only project permission writes, pending tool approvals, direct permission.list alias, approval decisions, pending provider question requests, provider question replies, and direct question.reject handling are visible from chat.",
    notes:
      "Project config cannot silently weaken the active BetterC0de permission preset.",
  },
  {
    id: "runtime-limits",
    area: "Attachments, tool output, compaction",
    status: "implemented",
    settings: "Settings > Compatibility > Runtime Limits",
    chat: "/attachments, /tool-output, /compaction",
    evidence:
      "Image attachment limits, tool output limits, compaction settings, BETTERC0DE_DISABLE_AUTOCOMPACT/BETTERC0DE_DISABLE_PRUNE environment overrides, BETTERC0DE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, BETTERC0DE_WEBSEARCH_PROVIDER, and related experimental runtime controls are parsed, exposed, and safely writable to betterc0de.json through config-only chat commands where BetterC0de stores them in project config. Legacy paste-summary config is accepted for compatibility; composer text always remains editable.",
    notes: "Image attachment resizing follows project policy in the composer.",
  },
  {
    id: "sessions",
    area: "Sessions, forks, pins, undo/redo",
    status: "implemented",
    settings: "Settings > Compatibility / General app settings",
    chat: "/sessions, /session list, /session delete, /session.list --format json, /session.get, /session.update, /session.status, /session.children, /session.messages, /betterc0de-sync, /betterc0de-session-list --terminal, /betterc0de-session-delete --terminal, /fork, /parent, /child, /pin, /undo, /redo, /session.revert, /session.unrevert, /archive, /delete-session",
    evidence:
      "Session navigation, BetterC0de-compatible table/JSON session listing with max-count plus v2-style order/search/path/roots/start/cursor filters, BetterC0de-compatible `/session list|delete` subcommands, session.update title/archive/unarchive/permission routing to BetterC0de equivalents, session get/status aliases, message listing aliases, BetterC0de sync.history/start/replay/steal compatibility outputs with cursor/payload validation and local thread/activity snapshots, raw BetterC0de `betterc0de session list/delete` terminal-prefill entrypoints with list format/max-count and delete session-id validation, fork tree navigation/children aliases, pinned quick slots, checkpoints via revert/unrevert aliases, archives, and deletes are exposed.",
    notes:
      "Provider-native runtime state may not fully advance after checkpoint restore.",
  },
  {
    id: "session-io-stats",
    area: "Session import/export and stats",
    status: "implemented",
    settings: "Settings > Compatibility / General app settings",
    chat: "/export, /import <file.json|url>, /betterc0de-import, /stats",
    evidence:
      "Markdown export remains available; BetterC0de session.export/betterc0de-export aliases default to BetterC0de-compatible JSON, support a positional BetterC0de session id, include optional sanitization, local BetterC0de/BetterC0de JSON import, BetterC0de share-array import, HTTP(S) import, BetterC0de /share/<id> and /s/<id> share URL candidate import, --terminal prefills for raw betterc0de export/import commands, and betterc0de stats-style token/tool usage summaries are available from chat with the compatibility source's hidden-by-default model usage, --models opt-in, project/today/tool/model filters, and numeric filter validation.",
    notes:
      "Import is explicit and keeps remote fetch failures visible instead of silently mutating chat history.",
  },
  {
    id: "github-pr-workflows",
    area: "GitHub agent and PR workflows",
    status: "partial",
    settings: "Settings > Compatibility / Provider settings",
    chat: "/github, /github.install, /github.run, /pr <number>, /review",
    evidence:
      "BetterC0de github install/run entrypoints and pr targeting are visible from chat; BetterC0de-compatible `/github install` and `/github run` subcommands map to the same flows as `/github.install` and `/github.run`; /github.install --workflow-only can write the workspace .github/workflows/betterc0de.yml file with provider/model inference, secrets, BetterC0de-compatible default provider secret references, Amazon Bedrock OIDC/no-secret handling, plus action inputs for agent, share, prompt, mentions, variant, use_github_token, and oidc_base_url with missing-value, boolean, env-name, and five-field schedule cron validation, supports canonical GitHub event names plus comment/issue/pr/manual/scheduled trigger aliases with unsupported-trigger and prompt validation for events that have no comment body, upgrades workflow permissions only for explicit use_github_token mode, and the workflow trigger condition follows custom mentions; /github.run maps model/run-id/share/use_github_token/oidc/variant flags to the BetterC0de MODEL/GITHUB_RUN_ID/SHARE/USE_GITHUB_TOKEN/OIDC_BASE_URL/VARIANT environment with BetterC0de-compatible provider/model, missing-value, and boolean validation, surfaces local mock validation, --terminal prefills BetterC0de github install/run and legacy pr CLI commands, PR URLs are normalized to the compatibility source's numeric pr argument, invalid terminal PR targets warn before checkout, /pr routes to a read-only PR review prompt unless terminal mode is explicit, and the safe PR prompt preserves the compatibility source's shared-session import behavior as explicit /import guidance.",
    notes:
      "BetterC0de does not auto-install GitHub Apps, exchange GitHub tokens, force-checkout PR branches, or spawn betterc0de from chat without an explicit mutation path.",
  },
  {
    id: "debug-diagnostics",
    area: "Debug info, paths, VCS, and database path",
    status: "implemented",
    settings: "Settings > Compatibility / General app settings",
    chat: "/debug-info, /global.health, /debug.paths, /paths, /path.get, /debug.config, /debug.lsp, /debug-rg, /debug.file.read, /file.read, /file.list, /file.status, /find, /find.file, /find.symbol, /events, /event.subscribe, /debug-snapshot, /debug-startup, /debug-v2, /vcs, /vcs.get, /vcs.status, /vcs.diff, /vcs.apply, /db.path",
    evidence:
      "BetterC0de exposes BetterC0de-compatible debug info, sanitized runtime diagnostics, BetterC0de plugin runtime state including external plugins disabled (--pure) and BETTERC0DE_DISABLE_DEFAULT_PLUGINS, local app paths, BetterC0de compatibility config/data/state/cache/bin/log/repos/plugin-meta/database paths including BETTERC0DE_CONFIG_DIR and BETTERC0DE_DB, project config diagnostics including debug.config JSON preview plus terminal handoff for fully resolved BetterC0de output, LSP diagnostics, read-only file status/list/read/search/tree/ripgrep diagnostics with BetterC0de --limit/--query/--glob handling, direct file.read/file.list/file.status and find.text/find.files/find.symbols aliases, event.subscribe snapshots for local thread activity, VCS status/diff/raw-diff views, explicit vcs.apply guidance with reviewed terminal handoff, snapshot/checkpoint diagnostics, startup/scrap/v2/wait debug guidance with terminal prefill, and the SQLite database path from chat.",
    notes:
      "Arbitrary database query/migration commands are intentionally not exposed from chat.",
  },
  {
    id: "sharing",
    area: "Session sharing",
    status: "implemented",
    settings: "Settings > Compatibility > Config Settings",
    chat: "/share, /unshare",
    evidence:
      "BetterC0de share/autoshare policy, BETTERC0DE_AUTO_SHARE, and BETTERC0DE_DISABLE_SHARE gate chat sharing commands and report disabled/manual/auto modes.",
    notes: "Sharing remains explicit unless project config allows auto mode.",
  },
  {
    id: "plugins",
    area: "Plugins",
    status: "partial",
    settings: "Settings > Compatibility > Plugins & Tools",
    chat: "/project-plugins, /project-tools, /tool.list, /tool.ids, /plugins, /plugin-install, /plugin-toggle, /plugin, /plug",
    evidence:
      "Project, global, parent .betterc0de, and home .betterc0de plugin specs plus discovered plugin files are listed with source, validity, detail inspection, read-only plugin-meta.json load/version/theme metadata, BETTERC0DE_PURE skipped state, BETTERC0DE_DISABLE_DEFAULT_PLUGINS runtime visibility, /open hints for workspace-local plugin files, legacy tools flags, direct tool.list/tool.ids aliases, config-only tools writes, custom .betterc0de/tool(s) modules, BetterC0de plugin/plug entrypoint guidance, deprecated built-in auth plugin package warnings, --terminal prefills for raw plugin install flows with required-module validation, explicit config-only project plugin entry writes defaulting to the compatibility source's native .betterc0de config directory with an intentional --root-config escape hatch, non-secret optional plugin config objects, server/tui/both target patching with missing-value, target/config/option/boolean validation before writes, BetterC0de npm-package identity replacement semantics, and persistent .betterc0de/tui.json plugin_enabled toggles with missing-value validation.",
    notes:
      "BetterC0de intentionally does not execute npm installs or arbitrary project plugin code from chat; /plugin-install --config-only only patches the workspace plugin array, while /plugin-toggle --config-only patches TUI enablement.",
  },
  {
    id: "server-enterprise",
    area: "Server, enterprise, autoupdate, layout",
    status: "partial",
    settings: "Settings > Compatibility > Config Settings",
    chat: "/betterc0de-runtime, /betterc0de-tui, /betterc0de-run, /betterc0de-serve, /betterc0de-attach, /betterc0de-web, /betterc0de-acp, /betterc0de-upgrade, /betterc0de-uninstall, /betterc0de-generate, /betterc0de-completion, /betterc0de-db, /betterc0de-config",
    evidence:
      "server, enterprise, autoupdate, logLevel, shell, username, server username/password auth, BETTERC0DE_GIT_BASH_PATH, BETTERC0DE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS, BETTERC0DE_DISABLE_LSP_DOWNLOAD, BETTERC0DE_DISABLE_MODELS_FETCH, BETTERC0DE_MODELS_URL, BETTERC0DE_MODELS_PATH, BETTERC0DE_AUTO_HEAP_SNAPSHOT, BETTERC0DE_EXPERIMENTAL_FILEWATCHER, BETTERC0DE_EXPERIMENTAL_DISABLE_FILEWATCHER, BETTERC0DE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT, BETTERC0DE_DIRECT_TRACE, BETTERC0DE_WORKSPACE_ID, BETTERC0DE_DISABLE_AUTOUPDATE, BETTERC0DE_ALWAYS_NOTIFY_UPDATE, BETTERC0DE_DISABLE_MOUSE, BETTERC0DE_DISABLE_TERMINAL_TITLE, BETTERC0DE_SHOW_TTFD, BETTERC0DE_ENABLE_PARALLEL, BETTERC0DE_REPO_CLONE_GITHUB_BASE_URL, BETTERC0DE_CLIENT, snapshot, default_agent, layout, watcher, attachment, tool_output, compaction, and experimental/runtime flag fields are visible; /betterc0de-runtime --config-only can write safe runtime/app config fields using BetterC0de network flag aliases like --port/--hostname/--mdns/--mdns-domain/repeated --cors, with missing-value, log-level, positive/non-negative integer, boolean, share/autoupdate/layout validation before file writes; app.console/app.debug toggle the local console, app.log writes BetterC0de-compatible local log payloads, current and legacy BetterC0de terminal UI bus route IDs such as tui.prompt.append, tui.command.execute, tui.toast.show, and tui.session.select map to BetterC0de equivalents, BetterC0de global --log-level/--print-logs/--pure flags are preserved for terminal handoff with --log-level validation, BetterC0de run/TUI validation conflicts such as --interactive with --command/--format json, --interactive without a terminal/TTY, --fork without --continue/--session, inline boolean true/false state for conflict checks, invalid --format values, invalid provider/model ids, invalid --port values, invalid inline boolean values, invalid run --attach URLs, optional empty run --title values, missing attach command URLs, missing option values including empty inline `--option=`, and run without message/--command are surfaced before terminal handoff, maintenance validation covers upgrade --method choices, uninstall boolean flags, db --format choices, and direct BetterC0de DB path lookup, DB shell/query mode parsing skips `--format` option values, and BetterC0de default TUI thread, run/serve/attach/web/acp plus upgrade/uninstall/generate/completion/db entrypoints can prefill the integrated terminal with --terminal, including shell completion, specific db path, db migrate aliases, interactive db shell guidance, and query-only db --format validation.",
    notes:
      "BetterC0de keeps its own app lifecycle and update system, and does not auto-start long-running BetterC0de server/stdin protocols from chat.",
  },
]

export function buildBetterC0deParityMarkdown(): string {
  return [
    "# BetterC0de Compatibility Audit\n",
    "| Area | Status | Settings | Chat | Notes |",
    "|:-----|:-------|:---------|:-----|:------|",
    ...BETTERC0DE_PARITY_AREAS.map(
      (area) =>
        `| **${escapeTable(area.area)}** | ${formatStatus(area.status)} | ${escapeTable(area.settings)} | \`${escapeTable(area.chat)}\` | ${escapeTable(area.notes)} |`
    ),
    "",
    "## Status Legend\n",
    "| Status | Meaning |",
    "|:-------|:--------|",
    "| Implemented | BetterC0de exposes and actively maps the compatibility feature. |",
    "| Partial | BetterC0de exposes the feature and maps the safe subset; provider/runtime-specific behavior may remain delegated. |",
    "| Native | The behavior is handled by the browser/Electron native input layer plus BetterC0de glue. |",
    "| Display-only | BetterC0de intentionally lists compatible config for visibility but does not execute that subsystem. |",
  ].join("\n")
}

export function buildBetterC0deCliParityMarkdown(
  args: ReadonlyArray<string> = []
): string {
  const query = args
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim()
  const normalizedQuery = normalizeCliParityQuery(query)
  const rows = normalizedQuery
    ? BETTERC0DE_CLI_ENTRYPOINTS.filter((entry) =>
        betterC0deCliEntrypointMatches(entry, normalizedQuery)
      )
    : BETTERC0DE_CLI_ENTRYPOINTS
  const counts = BETTERC0DE_CLI_ENTRYPOINTS.reduce(
    (acc, entry) => {
      acc[entry.status] += 1
      return acc
    },
    {
      implemented: 0,
      partial: 0,
      native: 0,
      "display-only": 0,
    } satisfies Record<BetterC0deParityStatus, number>
  )

  return [
    "# BetterC0de CLI Compatibility\n",
    `Tracked entrypoints: ${BETTERC0DE_CLI_ENTRYPOINTS.length}`,
    normalizedQuery
      ? `Filter: \`${escapeTable(query)}\` (${rows.length} match${rows.length === 1 ? "" : "es"})`
      : "",
    `Implemented: ${counts.implemented} · Partial: ${counts.partial} · Native: ${counts.native} · Display-only: ${counts["display-only"]}`,
    "",
    rows.length === 0
      ? "> No external CLI reference matched this filter."
      : "",
    rows.length === 0 ? "" : "| External CLI reference | BetterC0de chat/settings | Status | Notes |",
    rows.length === 0 ? "" : "|:-------------|:--------------------------|:-------|:------|",
    ...rows.map(
      (entry) =>
        `| \`${escapeTable(entry.cli)}\` | \`${escapeTable(entry.chat)}\` | ${formatStatus(entry.status)} | ${escapeTable(entry.notes)} |`
    ),
    "",
    "> Use `/betterc0de-cli <query>` to filter by command, chat alias, status, or note. Use `/betterc0de-audit` for the higher-level feature area audit, or Settings > Compatibility for the same command map next to project config state.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export function buildBetterC0deHttpParityMarkdown(
  args: ReadonlyArray<string> = []
): string {
  const query = args
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim()
  const normalizedQuery = normalizeHttpParityQuery(query)
  const rows = normalizedQuery
    ? BETTERC0DE_HTTP_OPERATIONS.filter((operation) =>
        betterC0deHttpOperationMatches(operation, normalizedQuery)
      )
    : BETTERC0DE_HTTP_OPERATIONS
  const counts = BETTERC0DE_HTTP_OPERATIONS.reduce(
    (acc, operation) => {
      acc[operation.status] += 1
      return acc
    },
    {
      implemented: 0,
      partial: 0,
      native: 0,
      "display-only": 0,
    } satisfies Record<BetterC0deParityStatus, number>
  )

  return [
    "# BetterC0de HTTP/API Compatibility\n",
    `Tracked operations: ${BETTERC0DE_HTTP_OPERATIONS.length}`,
    normalizedQuery
      ? `Filter: \`${escapeTable(query)}\` (${rows.length} match${rows.length === 1 ? "" : "es"})`
      : "",
    `Implemented: ${counts.implemented} · Partial: ${counts.partial} · Native: ${counts.native} · Display-only: ${counts["display-only"]}`,
    "",
    rows.length === 0
      ? "> No compatibility HTTP/API operation matched this filter."
      : "",
    rows.length === 0
      ? ""
      : "| Operation | HTTP | BetterC0de chat/settings | Status | Notes |",
    rows.length === 0
      ? ""
      : "|:----------|:-----|:--------------------------|:-------|:------|",
    ...rows.map(
      (operation) =>
        `| \`${escapeTable(operation.id)}\` | \`${operation.method} ${escapeTable(operation.path)}\` | \`${escapeTable(operation.chat)}\` | ${formatStatus(operation.status)} | ${escapeTable(operation.notes)} |`
    ),
    "",
    "> Use `/betterc0de-api <query>` to filter by operation id, method, path, chat alias, status, or note. Use `/betterc0de-cli` for CLI entrypoints and `/betterc0de-audit` for the higher-level feature area audit.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export function betterC0deGapRows(): BetterC0deGapRow[] {
  return [
    ...BETTERC0DE_PARITY_AREAS.filter(isBetterC0deGapStatus).map(
      (area): BetterC0deGapRow => ({
        surface: "Feature area",
        id: area.id,
        entry: area.area,
        access: area.chat,
        status: area.status,
        notes: area.notes,
      })
    ),
    ...BETTERC0DE_CLI_ENTRYPOINTS.filter(isBetterC0deGapStatus).map(
      (entry): BetterC0deGapRow => ({
        surface: "CLI",
        id: entry.cli,
        entry: entry.cli,
        access: entry.chat,
        status: entry.status,
        notes: entry.notes,
      })
    ),
    ...BETTERC0DE_HTTP_OPERATIONS.filter(isBetterC0deGapStatus).map(
      (operation): BetterC0deGapRow => ({
        surface: "HTTP/API",
        id: operation.id,
        entry: `${operation.method} ${operation.path}`,
        access: operation.chat,
        status: operation.status,
        notes: operation.notes,
      })
    ),
  ]
}

export function buildBetterC0deGapMarkdown(
  args: ReadonlyArray<string> = []
): string {
  const query = args
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim()
  const normalizedQuery = normalizeGapQuery(query)
  const rows = betterC0deGapRows()
  const filteredRows = normalizedQuery
    ? rows.filter((row) => betterC0deGapRowMatches(row, normalizedQuery))
    : rows
  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1
      acc[row.surface] += 1
      return acc
    },
    {
      partial: 0,
      "display-only": 0,
      "Feature area": 0,
      CLI: 0,
      "HTTP/API": 0,
    } satisfies Record<
      BetterC0deGapRow["status"] | BetterC0deGapRow["surface"],
      number
    >
  )

  return [
    "# BetterC0de Gap Report\n",
    `Tracked gaps: ${rows.length}`,
    normalizedQuery
      ? `Filter: \`${escapeTable(query)}\` (${filteredRows.length} match${filteredRows.length === 1 ? "" : "es"})`
      : "",
    `Partial: ${counts.partial} · Display-only: ${counts["display-only"]}`,
    `Feature areas: ${counts["Feature area"]} · CLI: ${counts.CLI} · HTTP/API: ${counts["HTTP/API"]}`,
    "",
    filteredRows.length === 0
      ? "> No BetterC0de compatibility gap matched this filter."
      : "",
    filteredRows.length === 0
      ? ""
      : "| Surface | Gap | Access | Status | Notes |",
    filteredRows.length === 0 ? "" : "|:--------|:----|:-------|:-------|:------|",
    ...filteredRows.map(
      (row) =>
        `| ${escapeTable(row.surface)} | \`${escapeTable(row.entry)}\` | \`${escapeTable(row.access)}\` | ${formatStatus(row.status)} | ${escapeTable(row.notes)} |`
    ),
    "",
    "> Use `/betterc0de-gaps <query>` to filter by surface, route, command, access path, status, or note. The report intentionally excludes implemented/native rows so the remaining work stays visible.",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

function normalizeCliParityQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function betterC0deCliEntrypointMatches(
  entry: BetterC0deCliEntrypoint,
  normalizedQuery: string
): boolean {
  const haystack = normalizeCliParityQuery(
    `${entry.cli} ${entry.chat} ${entry.status} ${entry.notes}`
  )
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function normalizeHttpParityQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function betterC0deHttpOperationMatches(
  operation: BetterC0deHttpOperation,
  normalizedQuery: string
): boolean {
  const haystack = normalizeHttpParityQuery(
    `${operation.id} ${operation.method} ${operation.path} ${operation.chat} ${operation.status} ${operation.notes}`
  )
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function isBetterC0deGapStatus<T extends { status: BetterC0deParityStatus }>(
  item: T
): item is T & { status: Extract<BetterC0deParityStatus, "partial" | "display-only"> } {
  return item.status === "partial" || item.status === "display-only"
}

function normalizeGapQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function betterC0deGapRowMatches(
  row: BetterC0deGapRow,
  normalizedQuery: string
): boolean {
  const haystack = normalizeGapQuery(
    `${row.surface} ${row.id} ${row.entry} ${row.access} ${row.status} ${row.notes}`
  )
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}

function formatStatus(status: BetterC0deParityStatus): string {
  switch (status) {
    case "implemented":
      return "Implemented"
    case "partial":
      return "Partial"
    case "native":
      return "Native"
    case "display-only":
      return "Display-only"
  }
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}
