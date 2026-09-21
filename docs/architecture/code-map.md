# Code map

Where things live, what each folder is for, and where the remaining large
files are. `overview.md` explains the request flow; this file is the tree.

```
BetterC0de/
├── apps/
│   ├── backend/src/          Local Node server (Hono + WebSocket + SQLite)
│   ├── ui/src/               Electron renderer (React 19 + Vite + zustand)
│   ├── shell/                Electron main + preload (.cjs; tests in scripts/
│                            and the renderer reference suite)
│   └── mobile/src/           Expo companion (paired client of the backend)
├── packages/schema/src/      Shared Zod contracts and pure helpers
├── docs/architecture/        Decisions and maps (this file)
└── scripts/                  Build, audit and smoke tooling (not a workspace)
```

## Backend — `apps/backend/src`

Layering is `http → services → provider → persistence`; `eslint.config.js`
freezes the boundaries that were measured at zero violations.

```
backend/src/
├── index.ts, inProcess.ts     Entry points (child process / in-process)
├── bootstrap/                 Startup phases, in order
│   ├── env.ts  settings.ts  persistence.ts  providers.ts
│   ├── http.ts                HTTP app + WsHub wiring (remote-access thunks)
│   ├── recovery.ts  schedulers.ts  lifecycle.ts  shutdown.ts
│   └── context.ts             The AppState assembled by the phases
├── http/
│   ├── router.ts              Middleware order, CORS, drain gate, rate limits
│   ├── routes/                One file per resource
│   │   ├── chat.ts            Dispatch, approvals, goals (calls services/chat)
│   │   ├── threads.ts         Thread persistence — the only write path
│   │   ├── settings.ts        Public settings; remote deny-list lives here
│   │   ├── git.ts  filesystem.ts  workspace.ts  shell.ts
│   │   └── providers.ts  projects.ts  permissions.ts  runtime.ts
│   ├── contracts.ts           Typed request/response via @betterc0de/schema
│   └── middleware/            Rate limiting, auth, remote scope
├── services/
│   ├── chat/                  Dispatch lifecycle, requests, goals, history
│   ├── threads/
│   │   ├── service.ts         ThreadService (sequencing writes)
│   │   ├── statements.ts      Every prepared SQL statement it runs
│   │   └── parsers.ts
│   ├── git/                   Split by concern; `services/git` stays the import
│   │   ├── process.ts         Admission limits, bounded output, termination
│   │   ├── refs.ts  status.ts  commands.ts  diff.ts
│   │   ├── worktrees.ts  checkpoints.ts  profile.ts
│   │   └── index.ts
│   ├── workspace/             Files, search, MCP, plugins, trust, authorization
│   ├── checkpoint-recovery-fence.ts, checkpoint-revert-saga.ts
│   ├── shell.ts  terminalPty.ts  text-generation.ts  …
├── provider/
│   ├── runtime/               THE provider stack (new work goes here)
│   │   ├── ProviderHub.ts, ProviderRuntimeIngestion.ts   Journal → project → broadcast
│   │   ├── ProviderRuntimeEventJournal.ts, …Replayer.ts, …RecoveryStore.ts
│   │   ├── claude/            Claude Agent SDK adapter
│   │   ├── codex/             Codex app-server adapter
│   │   │   └── translator/    Codex notifications → runtime events, per family
│   │   ├── acp/               Shared ACP runtime (Cursor, Grok)
│   │   ├── cursor/  grok-cli/ Per-provider ACP profiles
│   │   ├── betterc0deCompat/  BetterC0de-server compatibility adapter
│   │   ├── claudeTerminal/    Backend-only, opt-in
│   │   └── legacyBridge.ts    Bridge to the legacy stack below
│   ├── activity-projection/   Runtime events → ThreadActivity rows, per family
│   ├── adapters/, adapter.ts, service.ts   Legacy stack (no new importers)
│   ├── agent-loop/            In-house tool loop for direct-API providers
│   ├── catalog/               Provider/model catalogs
│   └── permissions.ts, agent-permission-*.ts, project-tool-policy.ts
├── persistence/               SQLite: db.ts, migrations, projections, eventStore
├── remote/                    Pairing, sessions, LAN/tailnet policy, Tailscale
│   ├── http.ts                Identity, transport predicates, pairing limiter
│   ├── privateNetwork.ts      `isPrivateLanAddress`, `forwardedClientAddress`
│   └── service.ts  tailscale.ts  web.ts  terminalGrant.ts
├── ws/                        WsHub (upgrade policy, auth, replay journal, RPC)
├── auth/  security/  observability/  lifecycle/  cli/  settings/  checkpointing/
└── appState.ts  config.ts  constants.ts  errors.ts
```

## Renderer — `apps/ui/src`

```
ui/src/
├── main.tsx, App.tsx          Bootstraps hooks/use-app-shell*
├── lib/                       Pure logic and zustand stores (no React components)
│   ├── chat-store.ts, chat/   Thread + streaming state, selectors, types
│   ├── provider-events/       The one provider event entry point
│   │   ├── index.ts           handleProviderEvent, flushPendingDeltas
│   │   ├── normalize.ts       Any wire shape → one vocabulary
│   │   ├── handle.ts          The switch; delta barrier; store mutations
│   │   ├── activities/        Event → ThreadActivity row, same families as the backend
│   │   ├── delta-coalescing.ts  Frame-coalesced streaming, plan capture
│   │   ├── turn-artifacts.ts  Assistant items, plans, diffs, checkpoints
│   │   └── payload.ts         Payload readers (mirrors backend shared.ts)
│   ├── slash-command-runtime.ts  The slash ladder
│   ├── slash-command-catalog.ts  BUILTIN_COMMANDS data
│   ├── slash-command-query.ts    Trigger detection, ranking, replacement
│   ├── settings-store.ts, preferences-store.ts, checkpoint-store.ts, …
│   └── pending-*.ts           Approval / user-input / attention derivations
├── hooks/
│   ├── use-chat-submit.ts     Submit path; imports the runtime on submit
│   ├── chat-submit/           Slash command implementations by dependency
│   ├── use-panes.ts           Agent-mode pane grid
│   └── use-provider-*.ts, use-composer-tabs.ts, …
├── components/
│   ├── chat/                  Transcript, composer, tool rows, goal card
│   ├── layout/                Main area, panes, sidebars, workspace panel
│   ├── design/                Canvas mode (folder keeps its old name): canvas, cards,
│   │                          canvas-preview-store (inspector focus), canvas-runtime-* (pane)
│   ├── browser-preview/       Live preview, element inspector, inspector-state, select-browse-toggle
│   ├── settings/, dialogs/, sidebar/, editor/, file-tree/
│   ├── ui/, ai-elements/, kibo-ui/   Component kits
│   └── slash-commands.tsx     The menu (re-exports catalog + query)
├── services/backend/          HTTP/WS client, one file per API area
└── types/                     electron-api.d.ts, IPC channel lists
```

`lib/` never imports `hooks/` or `components/`; `hooks/chat-submit/` exports
no hooks (it is the slash implementation folder; the name is historical).

## Mobile — `apps/mobile/src`

```
mobile/src/
├── app/                       expo-router screens
├── store/app-store.ts         Threads, messages, streams, requests
├── store/session-store.ts     Pairing profile, connection checks
├── lib/remote-api.ts          HTTP client
├── lib/remote-socket.ts       WebSocket with replay cursor, 4401 handling
├── lib/runtime-events.ts      Frame decoding (twin of renderer normalize)
└── components/                message-item/ (rows, tool-calls, file-changes), composer, request cards, …
```

Mobile re-implements rather than shares the renderer's client logic; a fix
in `apps/ui/src/lib` often has a twin in `apps/mobile/src/lib`.

## Shared — `packages/schema/src`

Zod schemas and pure helpers used by all three clients and the backend.
Subpath exports (`./json-read`, `./provider-replay`, `./tool-activity`, …)
exist for lean consumers; `index.ts` re-exports everything else.

- `json-read.ts` — `isRecord`, `asRecord`, `readString`, `readTrimmed`,
  `readNumber`, `readBoolean`. Import these; do not redeclare them.
- `tool-activity.ts` — how a tool call is described (`describeProviderToolActivity`).
- `thread-goal.ts` — `/goal` command parsing shared by desktop, mobile, backend.
- `http-contracts.ts` — typed endpoints (coverage remains incremental).

## Remaining large units (2026-09-17)

Kept deliberately or not yet split. Complexity is allowed at the adapter
boundary; the inland ones are the candidates.

| File | Unit | Lines | Note |
| --- | --- | --- | --- |
| `apps/ui/src/lib/slash-command-runtime.ts` | `runSlashLadder` | ~3800 | Central ladder by decision; split must follow the dependency graph |
| `apps/backend/src/provider/runtime/claude/ClaudeAdapter.ts` | `query` wrapper, `sendTurn` | ~1400 / ~665 | SDK boundary |
| `apps/backend/src/provider/runtime/betterc0deCompat/BetterC0deCompatAdapter.ts` | `handleWorkspaceEvent` | ~450 | Was one 1330-line method; now five family methods |
| `apps/backend/src/provider/runtime/ProviderRuntimeIngestion.ts` | `processEvent` | large | The journal lane; not transactional on purpose |
| `apps/ui/src/lib/provider-events/activities/` | four family projectors | ~1000 | Twin of backend `activity-projection`, cut the same way; folding the two is the real fix |
