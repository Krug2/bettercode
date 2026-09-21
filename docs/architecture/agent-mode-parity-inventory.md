# Agent Mode parity inventory and implementation plan

Status: implementation snapshot complete; final acceptance validation pending  
Implementation snapshot: 2026-07-24  
Survey baseline: `d9df024` plus preserved user-owned working-tree changes  
Reference notation: `$REF_ROOT` means the read-only reference implementation
root supplied with the repository. Every reference path below is relative to
that root so no upstream identity is copied into BetterC0de.

## Purpose and completion rule

This document is the architecture-first inventory required before Agent Mode
parity work begins. It maps reference behavior to BetterC0de's existing
contracts, records adaptations forced by the Electron/Hono/React/SQLite stack,
and defines reviewable implementation gates.

Parity is complete only when every row marked partial or missing below is
implemented, tested, reachable through the product UI, and covered by the final
brand and theme audits. A similar-looking control is not parity unless it
performs an authoritative operation and survives restart/replay where the
operation is durable.

The reference tree remains read-only and is never a build input.

## Architecture map

### Reference control flow

1. Typed HTTP/RPC commands enter the orchestration command boundary.
2. Command invariants and the decider produce ordered domain events.
3. provider-command reactors route work to a durable provider session.
4. Provider adapters translate native SDK, CLI, or ACP activity into a
   provider-neutral runtime event stream.
5. Runtime ingestion appends structural events before projection, publishes a
   receipt, and updates read models.
6. Projection pushes carry monotonic sequence data to clients.
7. Client state replays the authoritative snapshot plus ordered pushes and
   renders the timeline, requests, plan, changed files, and inspectors.
8. Checkpoint and Git reactors perform workspace mutations behind durable,
   recoverable operations.

The critical reference state machines are:

- connection: `connecting -> open -> reconnecting -> closed -> disposed`;
- provider session: `starting -> ready -> running -> stopping -> exited`, with
  explicit unavailable and recovery paths;
- turn: `queued -> running -> waiting-for-input|waiting-for-approval ->
  completed|aborted|failed`;
- request: `opened -> resolved`, correlated to session, turn, and native
  request identifiers;
- projection: command receipt -> event append -> projection -> push receipt;
- checkpoint: create hidden ref -> associate with turn -> diff/query -> revert
  saga -> cleanup;
- planning: read-only turn -> proposed plan artifact -> explicit approval or
  denial -> implementation turn.

### BetterC0de-native control flow

BetterC0de already has the correct outer seams:

- `packages/schema/src/*` owns public Zod contracts.
- `apps/backend/src/persistence/eventStore.ts` owns the durable append-only
  event log (the former `orchestration/*` command loop was removed in 2026-09
  with zero callers; see `AGENTS.md`).
- `apps/backend/src/provider/runtime/ProviderHub.ts` owns provider admission,
  session routing, timeouts, interruption, and adapter lifecycle.
- `apps/backend/src/provider/runtime/ProviderRuntimeIngestion.ts` owns the
  structural journal-first lane and the batched transcript lane.
- `apps/backend/src/provider/runtime/ProviderSessionBindingStore.ts` owns
  durable thread-to-native-session bindings.
- `/api/v1` HTTP routes and the `provider.runtimeEvent` WebSocket envelope are
  the renderer transport boundary.
- `apps/ui/src/lib/provider-events/` and `chat-store.ts` project canonical
  events into renderer state.
- Electron's existing typed IPC/preload contract remains the only desktop
  boundary.

The port will extend these seams. It will not replace a public API, introduce a
second event vocabulary, or move provider-native inner loops into the renderer.

## Reference file inventory

### Contracts, commands, and ordered projection

Reference implementation:

- `packages/contracts/src/providerRuntime.ts` — canonical session, turn,
  message, reasoning, item, tool, request, token, model, plan, diff, warning,
  and error events.
- `packages/contracts/src/provider.ts` and `providerInstance.ts` — adapter,
  provider, model, and instance contracts.
- `packages/contracts/src/orchestration.ts` — commands, events, receipts, read
  models, snapshots, and push envelopes.
- `apps/server/src/orchestration/Schemas.ts` — server command/event schema.
- `apps/server/src/orchestration/commandInvariants.ts` and `decider.ts` —
  preconditions and deterministic event decisions.
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — idempotent
  command execution and receipt publication.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — ordered
  projection and push delivery.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — command to
  provider dispatch.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` —
  provider-neutral event ingestion, including graceful tool denial.
- `packages/shared/src/DrainableWorker.ts` and
  `KeyedCoalescingWorker.ts` — drain-safe serialized and coalesced work.
- Corresponding `*.test.ts` files cover duplicate commands, receipts, settled
  state, ordering, projection snapshots, approvals, deletion, and draining.

Behavioral defaults and invariants:

- structural events are durable before they are visible;
- deltas may coalesce, but terminal events flush them;
- replay starts from a snapshot and an ordered cursor;
- disconnected client commands queue and the latest state is replayed;
- duplicate commands return the original receipt;
- a denied tool becomes inspectable activity and does not crash the turn.

### Provider runtime and session lifecycle

Reference implementation:

- `apps/server/src/provider/Services/ProviderAdapter.ts`,
  `ProviderService.ts`, `ProviderRegistry.ts`,
  `ProviderAdapterRegistry.ts`, `ProviderSessionDirectory.ts`, and
  `ProviderSessionReaper.ts` — provider-neutral runtime surface.
- `apps/server/src/provider/Layers/ProviderService.ts`,
  `ProviderSessionDirectory.ts`, and `ProviderSessionReaper.ts` — live service
  behavior and lifecycle tests.
- `apps/server/src/provider/Layers/{Claude,Codex,Cursor,Grok,OpenCode}Adapter.ts`
  — native event translation.
- `apps/server/src/provider/Layers/{Claude,Codex,Cursor,Grok,OpenCode}Provider.ts`
  — managed provider startup, capability probing, and status.
- `apps/server/src/provider/Drivers/*` — executable/home/config discovery and
  launch environments.
- `apps/server/src/provider/acp/*` — ACP JSON-RPC, native logging, extensions,
  session runtime, model mapping, and core runtime-event translation.
- `apps/server/src/provider/providerStatusCache.ts`,
  `providerMaintenance.ts`, `providerMaintenanceRunner.ts`, and
  `providerSnapshot.ts` — status, upgrades, and snapshots.
- `apps/server/integration/providerService.integration.test.ts` and adapter,
  layer, driver, and ACP tests — lifecycle and translation fixtures.

Important canonical behavior:

- explicit readiness rather than inferring readiness from process existence;
- one stable thread-to-provider session association;
- bounded reaping and deterministic stop/exit;
- native provider errors are normalized and terminal ordering is preserved;
- adapter dispatch errors cannot leave a turn permanently active;
- provider-specific details remain in metadata, not in the shared event kind.

### Agent loop, tools, harness, and process safety

Reference behavior is split between provider-native loops and the server-owned
outer harness:

- provider adapters and drivers own SDK/CLI launch and native inner loops;
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` owns ACP session calls;
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts` owns the Codex
  session protocol;
- `apps/server/src/mcp/toolkits/preview/tools.ts` and `handlers.ts` demonstrate
  typed toolkit discovery, validation, and failure normalization;
- `packages/shared/src/hostProcess.ts` and provider launch/runtime files own
  process collection and termination;
- provider adapter tests exercise cancellation, malformed events, process
  failure, and normalized terminal events.

Harness invariants to reproduce:

- every advertised tool is discoverable and executable in the active runtime;
- arguments are validated before dispatch;
- workspace-relative paths are confined to the workspace;
- timeout, cancellation, output truncation, and process exit are distinct
  results;
- a tool failure is returned to the model as a tool result;
- cancellation terminates the complete child-process tree;
- native provider allowlists never bypass the product permission boundary.

### Context, compaction, SDK accounting, and CLI imports

Reference implementation:

- provider runtime contracts carry model metadata, context-window usage,
  automatic-compaction capability, tool-use counts, durations, and input,
  cached-input, output, and reasoning tokens.
- turn completion carries the provider-reported total cost where available.
- `apps/web/src/lib/contextWindow.ts` and `ContextWindowMeter.tsx` calculate and
  render context pressure.
- chat composer and thread state files assemble user content, mentions,
  terminal context, pending annotations, skills, and provider options.
- provider drivers discover native homes, instructions, skills, commands,
  agents, MCP servers, and configuration using native precedence.
- `apps/server/src/provider/opencodeRuntime.ts`,
  `CodexDeveloperInstructions.ts`, `Drivers/ClaudeHome.ts`,
  `ClaudeSkills.ts`, and `CodexHomeLayout.ts` are the main discovery seams.
- parser, home-layout, skill, model, context-window, and composer tests capture
  precedence and malformed-input cases.

Accounting fields required in BetterC0de's canonical projection:

- used and total context;
- input, cached input, output, and reasoning token counts;
- tool-use count;
- turn duration;
- automatic-compaction indicator;
- total cost in USD when provider data or catalog pricing makes it available.

### Permissions, workspace trust, and rules

Reference behavior:

- permission requests are correlated runtime requests, not modal-local state;
- decisions include allow, deny, and persisted allow;
- tool and path scopes are evaluated before provider dispatch;
- denial resolves the request and feeds a safe explanation into the loop;
- project and user settings can persist grants;
- supervised and full-access runtime modes have explicit defaults;
- rule sources are merged in a deterministic global -> project -> directory
  order, with directory proximity and globs deciding applicability;
- the effective instructions are both injected into the system prompt and
  inspectable by the user.

Relevant reference seams:

- `packages/contracts/src/providerRuntime.ts` request and permission events;
- provider adapters' approval/request translations;
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.approval.test.ts`;
- provider home/config discovery in `apps/server/src/provider/Drivers/*`;
- project file/config contracts and tests in
  `packages/contracts/src/project.ts` and the shared project-file modules;
- settings contracts and tests in `packages/contracts/src/settings.ts`;
- composer approval UI under `apps/web/src/components/chat/ComposerPending*`.

Default compatibility rule:

- full-access is the normal execution default;
- supervised execution requires approval according to the effective policy;
- planning is read-only regardless of the normal execution default;
- a workspace must be trusted before persisted broad grants or destructive
  operations can be used.

### Planning

Reference implementation:

- proposed-plan events and plan-approval requests in the runtime contract;
- adapter translation of native plan updates and plan exit;
- request ingestion and resolution in the orchestration runtime;
- `apps/web/src/components/chat/ProposedPlanCard.tsx`;
- `apps/web/src/components/chat/ComposerPlanFollowUpBanner.tsx`;
- chat/composer logic and tests for pending approval and follow-up behavior.

Required state transition:

`read-only planning -> editable artifact -> explicit request-bound approval ->
implementation`

Editing a plan must not lose the native request identifier or start a parallel
turn while the planning turn remains blocked.

### Diff, patch, checkpoint, and undo

Reference implementation:

- `apps/server/src/checkpointing/CheckpointStore.ts` — hidden-ref checkpoint
  ownership.
- `CheckpointDiffQuery.ts`, `Diffs.ts`, and `Utils.ts` — checkpoint diff
  queries and normalized changed-file data.
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts` — lifecycle
  integration.
- `apps/web/src/components/DiffPanel.tsx`, `DiffPanelShell.tsx`,
  `DiffWorkerPoolProvider.tsx`, and `diffs/AnnotatableCodeView.tsx` — stacked
  and split presentation.
- `apps/web/src/diffPanelStore.ts`, `diffFileActions.ts`,
  `lib/diffRendering.ts`, `lib/checkpointDiffState.ts`, and
  `lib/turnDiffTree.ts` — viewer state and changed-file trees.
- All adjacent tests cover parsing, file actions, checkpoint queries, binary
  and missing files, tree grouping, and viewer state.

The reference supplies checkpoint diffs and whole-file actions but does not
provide a complete authoritative per-hunk accept/reject workflow. The product
brief explicitly requires that workflow, so BetterC0de must extend the
behavioral model with structured patch identities, optimistic revision checks,
conflict results, and hunk decisions rather than copying a view-only control.

### Opener and source navigation

Reference implementation:

- `packages/contracts/src/editor.ts` and filesystem contracts;
- file-browser, preview, path-display, and annotation files under
  `apps/web/src/components/files/*`;
- `apps/web/src/browser/openFileInPreview.ts`;
- chat markdown, changed-files tree, review comments, and terminal-link
  handlers;
- tests for paths, revisions, save coordination, annotations, and external
  links.

One typed target must represent:

- file;
- file plus line;
- file plus line and column;
- file plus start/end range;
- symbol;
- external URL.

The same resolver must be used from chat markdown, tool output, search,
problems, file trees, diffs, and Git results.

### Git, branches, worktrees, and restore points

Reference implementation:

- `packages/contracts/src/git.ts`, `sourceControl.ts`, and `vcs.ts`;
- `apps/server/src/git/GitManager.ts`, `GitWorkflowService.ts`,
  `remoteRefs.ts`, and `Utils.ts`;
- source-control provider integrations under `apps/server/src/sourceControl`;
- orchestration checkpoint reactor and hidden checkpoint refs;
- `apps/web/src/state/git.ts`, `BranchToolbar*`, `GitActionsControl*`, and
  thread action hooks;
- mobile Git sheets mirror the same server contract and are platform
  presentation, not a separate required backend;
- manager, workflow, contract, branch-toolbar, Git-action, and integration test
  plans cover status, staged/unstaged changes, branches, worktrees, restores,
  remotes, commits, push/pull, and destructive confirmations.

Guardrails:

- never pass unvalidated option-like user input to Git;
- destructive operations require explicit confirmation;
- checkpoint refs are hidden implementation details;
- worktree ownership is tied to the thread/environment;
- restore and cleanup are resumable after interruption.

### Workspace, context, session, and tool-call trees

Reference implementation:

- file navigation under `apps/web/src/components/files/*`;
- `apps/web/src/components/chat/ChangedFilesTree.tsx`;
- `apps/web/src/lib/turnDiffTree.ts`;
- messages timeline logic and thread state;
- pending request panels and grouped activity presentation;
- provider event correlation through session, turn, item, tool-use, task, and
  agent identifiers.

Required tree identities:

- workspace tree: normalized workspace-relative path;
- context tree: source kind + source identity + token contribution;
- session tree: thread/session/turn parentage;
- tool tree: parent agent/task/tool-use identifiers with stable event order.

### Keyboard defaults and interaction states

Reference implementation:

- `packages/contracts/src/keybindings.ts`;
- `packages/shared/src/keybindings.ts`;
- `apps/server/src/keybindings.ts`;
- `apps/web/src/keybindings.ts`;
- settings route and the adjacent contract/server/web tests.

Compatibility aliases to preserve where they do not replace an existing
BetterC0de binding:

- command palette: `mod+k`;
- terminal toggle: `mod+j`;
- terminal split/new/close while terminal-focused: `mod+d`, `mod+n`, `mod+w`;
- preview toggle: `mod+shift+j`;
- preview refresh/navigation/zoom family: `mod+r`, `mod+l`, `mod+=`,
  `mod+-`, `mod+0`;
- new chat/task variants: `mod+n`, `mod+shift+o`, `mod+shift+n`;
- open favorite: `mod+o`.

Shortcut handlers must retain editor/terminal focus guards and must be covered
by keyboard tests rather than relying on browser defaults.

## Reference defaults and edge-case ledger

These values are behavioral evidence, not a requirement to copy provider
branding or storage names.

### Runtime and limits

- Default runtime mode: `full-access`.
- Default interaction mode: `default`; the alternative is `plan`.
- Approval policies: `untrusted`, `on-failure`, `on-request`, `never`.
- Sandboxes: `read-only`, `workspace-write`, `danger-full-access`.
- Prompt maximum: 120,000 characters.
- Attachments per send: 8.
- Attachment maximum: 10 MiB each.
- Data URL maximum: 14,000,000 characters.
- Attachment ID/name/MIME maxima: 128/255/100 characters.
- General model default: `gpt-5.6-sol`.
- Text-generation model default: `gpt-5.6-luna`.
- Runtime session states: `starting`, `ready`, `running`, `waiting`,
  `stopped`, `error`.
- Turn terminals: `completed`, `failed`, `interrupted`, `cancelled`.
- Retention: 2,000 messages, 500 checkpoints, 200 proposed plans, and 500
  activities per projected thread.

### Provider and process behavior

- Provider snapshots normally refresh every 5 minutes.
- Provider-session inactivity reaping uses a 30-minute threshold and a
  5-minute sweep.
- General process timeout is 60 seconds.
- General process output is capped at 8 MiB per stream; truncate mode keeps
  draining after the cap to avoid pipe deadlock.
- Provider probes normally use 4 seconds; authentication probes use 10
  seconds.
- ACP session load uses 90 seconds, with a 2-second replay-idle fallback.
- The preview automation broker uses 15-second requests.
- Provider-scoped MCP credentials use 32 random bytes, store only a SHA-256
  hash, expire after 30 minutes idle or 8 hours absolute, and are revoked on
  stop/error/shutdown.
- Automatic Git fetch defaults to 30 seconds.
- New worktrees default to starting from the origin ref.
- Assistant delta streaming is disabled by default in the reference; the
  canonical projection still accumulates complete assistant text.

### Streaming and projection edge cases

- Cached thread detail may render before synchronization, but live events are
  not authoritative until the stream completion marker.
- Reconnect retry is 250 ms.
- Settled thread detail persists after a 500 ms debounce.
- Sequence numbers deduplicate replay/live overlap.
- A checkpoint event during a turn must not settle the turn.
- A placeholder checkpoint cannot replace a real ref.
- Assistant completion with empty text retains accumulated deltas.
- Approval and user-input boundaries flush the assistant segment.
- One malformed provider event cannot kill the reactor/worker.
- Lifecycle caches are bounded and session exit clears them.
- Retryable provider failures are warnings/heartbeats; there is no generic
  automatic replay of an entire agent turn.

### Approval, questions, and plan UI

- Pending approvals show command/path detail and support decline, approve once,
  approve for the session, and cancel turn.
- Duplicate responses are disabled while a decision is in flight.
- Structured questions support single choice, multiple choice, and free text.
- Keys `1`–`9` select answers outside editable controls; a single answer
  advances after 200 ms.
- Proposed plans auto-collapse above 900 characters or 20 lines and show a
  10-line collapsed preview.
- Plan actions include expand/collapse, copy, download, save to workspace,
  refine, and implement.
- Explicit plan dismissal suppresses automatic reopening for that turn.
- `Shift+Tab` switches plan/default interaction in the reference.

### Diff, checkpoint, and Git hazards

- Diff selection distinguishes base-ref changes, working-tree changes, and a
  checkpointed turn.
- Working-tree changes take initial precedence over branch changes.
- Fetch states include loading skeleton, non-Git, missing turn, no net change,
  empty/truncated patch, request failure, and structured-parser fallback to raw
  patch.
- The reference checkpoint restore runs a destructive clean of untracked
  workspace files. BetterC0de must not inherit that surprise: confirmation and
  recovery behavior must explicitly account for untracked data.
- Selective reference commits reset the index before staging chosen paths and
  therefore destroy an existing staging partition. BetterC0de must preserve or
  explicitly confirm that change.
- A reference default-branch warning is UI-only. BetterC0de guardrails must
  also be enforced at the backend mutation boundary.
- Git actions are serialized per workspace, status refreshes every 5 seconds,
  ref lists cache for 5 minutes, and stale action IDs are ignored.
- No per-hunk accept/reject, patch queue, or conflict resolver exists in the
  reference; those are explicit BetterC0de requirements.

### File and opener behavior

- File-tree initial expansion depth is 1.
- Text preview reads at most the first 1 MiB before becoming read-only.
- File saves debounce for 500 ms and serialize writes.
- Source targets accept file URLs, Windows drive/UNC paths, POSIX absolute
  paths, workspace-relative paths, and line/column fragments.
- Same-document fragments scroll locally; external URLs open separately.
- Right-panel surfaces are browser, terminal, diff, files, individual file,
  and plan, with singleton diff/files/plan surfaces.

## BetterC0de gap matrix

| Subsystem | BetterC0de counterpart | State | Required work |
| --- | --- | --- | --- |
| Agent loop | `ProviderHub.ts`; native runtime adapters; `provider/adapters/openaiCompat.ts`; `claudeApi.ts` | Partial | Normalize retry, cancellation, max-turn terminal behavior, policy, plan, and event ordering across every provider. |
| Session lifecycle | `ProviderSessionBindingStore.ts`, `ProviderSessionReaper.ts`, maintenance, adapter recovery | Mostly complete | Add cross-adapter terminal-order/recovery fixtures; preserve the existing control plane. |
| Ordered streaming | `ProviderRuntimeEventJournal.ts`, `ProviderRuntimeIngestion.ts`, recovery/replay/receipt stores, WebSocket replay cursor | Mostly complete | Add the missing denial event and adapter-neutral ordering fixtures; retain structural journal-first semantics. |
| Context/compaction | backend thread history, `thread-compaction.ts`, `chat-context.ts`, summary service | Partial | Move effective context assembly to a backend resolver; add threshold-driven automatic compaction and expose source/token breakdown. |
| Executable tool registry | `agent-loop/tool-catalog.ts`, `tool-executor.ts`, `shared/chat-mode-tools.ts` | Partial | Make advertised and executable catalogs identical; centralize schema validation, timeout, permission domain, truncation, and results. |
| Harness sandbox | workspace services, process supervision, provider-native sandbox options | Partial | Define one product sandbox policy and map each adapter to it; test process-tree termination and path confinement. |
| SDK/contracts | `packages/schema/src/provider-runtime.ts`, provider instance/model schemas, `ProviderAdapterShape` | Mostly complete | Extend compatibly for denial, authoritative patches, context sources, and cost; do not rename existing fields. |
| Token/cost accounting | token events, catalog pricing, thread stats | Partial | Canonically calculate/cache-aware cost and persist provider-reported cost where available. |
| CLI import | shell CLI scanner/plugin sync, CLI schema/hooks, native provider homes | Partial | Resolve commands, tools, agents, skills, MCP, and config with documented precedence and make them executable from all applicable runtimes. |
| Permissions | provider/project/session policy files, approval routes/UI | Partial | Enforce provider-neutrally; persist grants; add path scopes and workspace trust; emit graceful denial. |
| Rules | global-rules IPC, workspace instruction discovery, `project-rules.ts`, prompt builder | Partial | Produce one typed effective-rule artifact with source, scope, glob, precedence, content, and explanation in the backend. |
| Planning | proposed-plan schema, Claude request flow, plan views/cards/modal | Partial | Use one request-bound editable artifact; keep every provider read-only until explicit approval. |
| Structured patch | provider diff summaries and Git diff text | Missing | Add patch/revision schemas, dry-run/application service, idempotency, and conflict results. |
| Diff UI | `diff-panel.tsx`, changed-files UI | Partial | Wire unified/split views to authoritative per-hunk accept/reject/stage operations and show conflicts. |
| Checkpoint/undo | checkpoint reactor, hidden refs, revert operation/recovery fence | Mostly complete | Remove obsolete raw-restore behavior from UI and use the server revert saga everywhere. |
| Opener | editor store, go-to-line, symbols, external open-target service | Partial | Add one typed internal/external target resolver and use it from every Agent Mode surface. |
| Git | Git schema/service/routes/panel, worktrees, checkpoint refs | Mostly complete | Wire commit-message generation, expose worktree ownership, and put all mutations behind trust/confirmation policy. |
| Workspace tree | existing lazy project file tree | Complete foundation | Reuse it and add Agent-origin reveal/open actions only. |
| Context tree | context chips and meter | Missing | Add expandable, token-aware source tree backed by the backend context artifact. |
| Session tree | project/thread list and parent thread IDs | Partial | Render parent/fork/session/turn hierarchy with stable replay identity. |
| Tool-call tree | grouped tool rows and task/pipeline events | Partial | Render parent/child agent, task, and tool-use relationships rather than a flat chronological group. |
| Shortcuts/defaults | `use-global-shortcuts.ts`, preferences and settings | Partial | Add non-breaking aliases and a parity test manifest. |
| Product identity | runtime namespaces, storage/config compatibility, comments/docs/tests | Failing gate | Migrate active names to BetterC0de and keep any legacy reader internal without preserving forbidden identity text outside `$REF_ROOT`. |
| Theme/components | Tailwind theme variables, existing UI primitives, AI Elements | Complete foundation | Compose only from existing primitives/tokens; add no package, icon set, font, palette, or inline style. |

## State ownership decisions

To avoid renderer/provider divergence:

- provider-native state is authoritative only inside its adapter;
- canonical provider events are authoritative for live activity;
- the backend event journal and projection are authoritative for replay;
- SQLite owns durable grants, trust, checkpoints, plan artifacts, and patch
  decisions;
- renderer stores are disposable projections and may not invent successful
  mutations;
- UI buttons remain pending until the authoritative backend receipt/event;
- request IDs survive edits and navigation;
- patch application uses workspace revision/preimage checks;
- context and effective-rule artifacts are assembled in the backend for every
  client, not only the desktop renderer.

## Adaptations to BetterC0de

1. Effect services in the reference become existing TypeScript services and
   Zod schemas; no framework is imported.
2. Reference RPC/push behavior maps to the existing Hono routes and replayable
   WebSocket envelope.
3. Reference desktop bridges map to Electron's existing typed IPC/preload
   contract.
4. Reference atom/query state maps to existing Zustand stores and backend
   service modules, while backend projections remain authoritative.
5. Native mobile presentation is not copied; the same server contracts remain
   usable through BetterC0de's responsive web renderer.
6. Reference styling and assets are not ported. Existing BetterC0de buttons,
   dialogs, trees, tabs, scroll areas, tooltips, alerts, badges, and theme
   variables express the interactions.
7. Existing public API names and persisted records are extended with optional
   fields and additive endpoints. Migrations preserve old BetterC0de data.

## Phased implementation plan

### Phase 0 — inventory and regression floor

- Land this inventory.
- Preserve the concurrent Claude plan/error work without rebasing or
  overwriting it.
- Record baseline typecheck, production build, focused tests, current warnings,
  identity hits, and theme violations.
- Add a parity checklist that maps every requirement to an automated or manual
  acceptance test.

Gate: inventory reviewed; baseline builds; no production behavior changed.

### Phase 1 — canonical runtime and harness

- Add provider-neutral `tool.denied` and complete token/cost fields.
- Create one executable tool descriptor contract and derive advertised tools
  from it.
- Validate arguments before dispatch.
- Normalize timeout, cancellation, truncation, failure, denial, and
  max-turn-exhausted results.
- Map the common sandbox policy to direct SDK, CLI, and ACP adapters.
- Add cross-provider event-order and recovery fixture tests.

Gate: every provider produces the same canonical lifecycle for success,
failure, cancellation, denial, and retry; every advertised direct-loop tool is
executable.

### Phase 2 — permissions, trust, rules, and context

- Add provider-neutral durable permission grants and workspace trust storage.
- Evaluate tool and path scopes before every provider dispatch.
- Resolve denial into the native request plus a model-visible tool result.
- Implement the typed effective-rule resolver with global/project/directory,
  glob applicability, precedence, and provenance.
- Move system-context assembly behind the backend turn-start boundary.
- Add automatic compaction thresholds and a token/source context artifact.

Gate: the same policy result is observed for every provider and client; restart
preserves grants/trust; effective rules and context are inspectable.

### Phase 3 — CLI assets and planning

- Normalize native CLI discovery for commands, tools, agents, skills, MCP, and
  configuration.
- Remove prompt contradictions that advertise unavailable or forbidden CLI
  assets.
- Make relevant imported tools executable through the canonical registry.
- Persist one editable plan artifact correlated to the pending request.
- Enforce read-only planning for all providers.
- Resolve approval/denial before starting implementation.

Gate: imported assets follow documented precedence; an edited plan resumes the
blocked turn exactly once; plan-mode mutation tests fail closed.

### Phase 4 — authoritative edits, diffs, and undo

- Add structured patch, file revision, hunk identity, decision, receipt, and
  conflict schemas.
- Generate patches from tool/provider edits and retain them in the projection.
- Add dry-run and idempotent patch application endpoints.
- Implement per-hunk accept/reject and stage/unstage against authoritative
  preimages.
- Show conflicts without discarding user changes.
- Route all restore actions through the checkpoint revert saga.

Gate: inline and side-by-side views apply real operations; stale preimages
produce a conflict; per-hunk and whole-turn undo survive restart and replay.

### Phase 5 — opener, Git, and inspection trees

- Add a typed opener target and shared parser/resolver.
- Use it from markdown, tool results, diffs, search, problems, Git, and file
  trees.
- Wire commit-message generation and worktree ownership into the Git UI.
- Apply trust and destructive confirmation rules to every Git mutation.
- Build context, session, and tool-call trees from canonical parent IDs and
  backend artifacts.
- Add compatible shortcut aliases and focused interaction tests.

Gate: every displayed source target opens to the correct file/symbol/range;
tree state replays deterministically; Git mutations are guarded.

### Phase 6 — identity, design, and end-to-end completion

- Migrate every active namespace, environment/config/storage key, branch
  prefix, comment, fixture, log, and doc to BetterC0de conventions.
- Keep any compatibility reader isolated and test-only if removal would break
  existing BetterC0de user data; it must not expose forbidden identity text.
- Audit added JSX/CSS for hardcoded colors, fonts, radii, spacing, inline
  styles, copied CSS, new primitives, and new dependencies.
- Run the full backend, UI, packaging, smoke, source, branding, and bundle
  gates.
- Exercise every subsystem from the renderer through the backend and back via
  replay.
- Write the final handover with adaptations and any truly external limitation.

Gate: full suite and build pass; identity search outside `$REF_ROOT` is empty;
theme audit is clean; every requirement is reachable and authoritative.

## Verification matrix

| Gate | Verification |
| --- | --- |
| Schema/API compatibility | schema tests, backend typecheck, UI typecheck, old fixture decoding |
| Runtime ordering | adapter fixtures, ingestion/journal/replay/receipt tests, reconnect replay test |
| Harness | catalog parity, validation, path confinement, timeout, truncation, cancellation, process-tree tests |
| Permissions/trust | provider matrix, persisted grant restart, path scope, denial continuation, untrusted workspace tests |
| Rules/context | precedence/glob/provenance tests, backend-client parity, automatic compaction boundary tests |
| Planning | mutation-denied tests, edit-and-approve correlation, duplicate approval idempotency, rejection continuation |
| Patch/diff | parse/generate/dry-run/apply, stale revision conflict, per-hunk accept/reject, binary/rename/delete tests |
| Checkpoint | hidden-ref creation, revert saga, crash recovery, cleanup, UI receipt tests |
| Opener | file/line/column/range/symbol parsing and every surface integration |
| Git | status/stage/branch/worktree/restore/commit/push guardrail tests |
| Trees | stable IDs, parent correlation, collapse persistence, replay and empty/loading/error states |
| Shortcuts | platform modifier aliases plus editor/terminal focus guards |
| Design | dependency diff, token/class scan, inline-style and hardcoded-color scan, visual smoke |
| Identity | case-insensitive repository scan excluding `$REF_ROOT` |
| Release | `npm run lint`, `npm test`, `npm run test:backend`, `npm run build`, packaging/source/smoke gates |

## Baseline evidence

At survey time:

- UI and backend typechecks passed.
- The focused pending-approval test passed.
- The production backend/frontend build passed.
- Vendor chunk-cycle and bundle-budget audits passed.
- Existing Vite warnings remain for modules imported both statically and
  dynamically and for large chunks.
- The working tree contains concurrent, user-owned plan/error changes. They are
  not part of this inventory and must not be overwritten.
- The identity gate currently fails outside `$REF_ROOT`.

This baseline is diagnostic only. The completion audit must rerun every gate
against the final source state.

## Implementation completion appendix

This appendix records the implementation present in the shared working tree on
2026-07-24. It supersedes the historical `State` column in the gap matrix for
handover purposes. Final settled-tree acceptance evidence is recorded in
`docs/architecture/agent-mode-parity-handover.md`.

Status terms used below:

- **Implemented** means the authoritative backend/UI path exists and focused
  verification has been observed.
- **Adapted** means the behavior is complete within a documented
  provider/platform boundary rather than copied literally.
- **Validated** means the final complete suite, production build, packaged
  smoke, identity/package scan, and real Electron renderer inspection passed
  against the settled source state.

### Delivered implementation status

| Subsystem | Snapshot status | Delivered BetterC0de architecture |
| --- | --- | --- |
| Canonical runtime and denial | Implemented | Provider-neutral `tool.denied`, correlation fields, journal/projection preservation, graceful model-visible denial, and adapter-neutral permission enforcement were added without replacing the existing runtime vocabulary. |
| Direct SDK agent loops | Implemented/validated | OpenAI-compatible and Claude API loops advertise only executable validated tools, enforce mode-specific maximum turns, normalize results, account for token/cache usage, apply a 60-second cancellation ceiling, settle process/edit work, emit exactly one terminal tool result, and close turn-scoped resources on completion, interruption, or failure. |
| Provider lifecycle | Implemented/extended | Existing session binding, recovery, reaping, dispatch-failure, and terminal-order seams remain authoritative; provider adapters now retain session/task/agent/tool parent correlation through canonical and legacy bridges. |
| Portable MCP and CLI assets | Implemented with transport adaptations | One resolver merges imported runtime, live backend settings, and project/global MCP sources using imported < settings < project precedence. Cursor/Grok ACP receive resolved descriptors. Direct API loops dynamically discover and execute bounded stdio and Streamable HTTP tools. CLI discovery covers commands, agents, skills, MCP, and native configuration precedence. |
| Tool harness | Implemented/validated | The canonical catalog owns schemas, validation, permission domains, and executable parity. Workspace file services retain path confinement and preimage conflict checks; shell/tool results retain bounded output and explicit timeout/cancellation/error states. Approved Bash runs in a supervised native host shell, not an OS sandbox. |
| Token/cost accounting | Implemented where data exists | Canonical usage includes input, output, cache creation/read, total/used, context capacity, duration, tool-use count, automatic-compaction capability, and cost when provider data or catalog pricing is available. |
| Permissions and trust | Implemented | SQLite-backed user/workspace grants and workspace trust are exposed through authenticated routes. Tool/path evaluation is provider-neutral with deny > ask > allow precedence, root confinement, graceful denial, and explicit untrusted-workspace mutation guards. |
| Effective rules | Implemented | A backend resolver merges runtime/global settings, project guides, ancestor guides, configured instructions, and target-glob rules with provenance, applicability, truncation, deterministic precedence, prompt injection, API inspection, and settings UI. |
| Context and compaction | Implemented/validated | A backend context artifact reports effective rules, actual system-instruction size, normalized history, message/tool/pending-draft/attachment provenance, token estimates, provider usage, compaction generation/boundary, and exclusions. Every `/chat/send` caller traverses the backend coordinator preflight; eligible durable history is summarized within explicit bounds, provider sessions stop first, and the checkpoint/epoch transaction commits only after generation/message revalidation. |
| Planning | Implemented/extended | Planning uses read-only tool/provider ceilings, request-correlated proposed-plan artifacts, editable plan content, explicit approval/denial, persisted pending implementation state, and a single guarded transition into implementation. |
| Structured hunk operations | Implemented/validated | Git schemas and services expose exact single-hunk patches, SHA-256 patch identities, source/action compatibility, dry-run, optimistic patch preconditions, prepared-before-Git operation receipts, restart reconciliation, staged/working-tree application, and explicit conflicts. Direct Write/Edit also emit bounded structured diff artifacts with preimage/result hashes. |
| Diff and checkpoint UI | Implemented/validated | Unified/split diff presentation is backed by authoritative accept/reject/stage/unstage operations. Conflicts refresh instead of discarding edits. Existing checkpoint hidden refs and recoverable revert saga remain the undo authority; unsafe local-only redo is intentionally unavailable. Startup recovery uses liveness heartbeats plus an absolute bound, Windows-long-path checkpoint capture, idempotent target-ref reuse, and a numstat projection bounded to 4,096 files and 512 KiB of UTF-8 JSON when a full patch exceeds 32 MiB; survivor-process errors fail closed and durable projections retain the true file total. |
| Source opener | Implemented | One typed file/range/symbol/external target parser and resolver is used by markdown, inline code, tool paths, diffs, file tree, search, symbols, references, problems, Git, and Monaco reveal/navigation. Agent-produced paths are workspace-confined by default. |
| Git/worktrees | Implemented/extended | Git mutations share backend trust guards; destructive UI actions request confirmation; hunk mutations are authoritative; commit-message generation is wired; thread branches use the `agent/<8hex>/<slug>` convention; existing worktree/checkpoint ownership is preserved. |
| Context/session/tool trees | Implemented | Context provenance is backend-owned; session/fork and agent/task/tool trees use stable parent identities, preserve orphan/cycle visibility, and persist expansion state. |
| Shortcuts | Implemented | Non-breaking aliases and terminal/browser/editor focus guards are centralized and surfaced in the existing keyboard-shortcut UI. |
| Product identity | Validated | Active product-facing namespaces, labels, fixtures, branch conventions, and comments use BetterC0de conventions. Compatibility readers remain internal. Final source and packaged-archive scans are clean, and the read-only reference is neither modified nor shipped. |
| Theme/dependencies | Validated | Added UI uses existing primitives and semantic theme tokens. Final added-line and Electron renderer checks found no hardcoded theme expansion or overflow. No new package/version was introduced; three existing backend runtimes are also root production declarations for electron-builder traversal. |

### Implemented end-to-end flow

1. The turn boundary resolves workspace trust, mode ceilings, effective rules,
   history/context, and automatic-compaction state.
2. ProviderHub or the direct adapter selects the provider-specific execution
   boundary without changing the canonical event contract.
3. Advertised tools come from an executable catalog or the shared portable MCP
   resolver. Every actual call is evaluated by BetterC0de permissions before
   execution.
4. Structural runtime events are journaled before projection. Transcript
   deltas and terminal events retain ordering, correlation, usage, denial, and
   recovery information.
5. Backend services own every durable mutation: grants/trust, plan
   implementation, Git/hunk application, checkpoint recovery, and compaction
   generation.
6. Renderer stores remain disposable projections. Buttons wait for backend
   receipts/results, and source/tree views derive from typed artifacts rather
   than inferring successful mutations locally.

### Security and resource boundaries

- Durable permission grants are scoped by destination, workspace, tool, and a
  normalized workspace-relative path. Absolute/traversing scopes fail
  validation. Explicit deny wins over ask, which wins over allow.
- An explicitly untrusted workspace is denied at provider turn and Git
  mutation boundaries. For upgrade compatibility, a workspace without a trust
  record remains implicitly trusted; the UI/API can create an explicit trusted
  or untrusted record.
- Plan and Ask modes do not gain arbitrary MCP tools. Security mode preserves
  its approval ceiling. Direct external MCP tools are limited to
  Agent/Debug/default-agent modes and still traverse the shared tool gate.
- Direct MCP discovery is capped at 12 servers per turn, 32 tools per server,
  and 96 external tools total. Input schemas are capped at 64 KiB with depth
  and node limits; descriptions are capped at 2,048 characters.
- Direct MCP connect and list operations use 8-second limits; calls use a
  60-second total limit and the provider turn abort signal. Clients close in a
  `finally` path.
- Direct built-in tools use a 60-second total ceiling, propagate the provider
  abort signal, bound output and structured patches, terminate Bash process
  trees, and wait for Write/Edit settlement before returning one terminal
  result.
- Configured MCP secrets are never placed in error messages. Known
  environment/header/query values are removed from advertised descriptions,
  schemas, and normalized results. Binary content is summarized rather than
  replayed as base64.
- Stdio MCP uses argv spawning rather than a shell and discards child stderr.
  Streamable HTTP allows HTTPS or loopback HTTP, rejects credential-bearing
  URLs, redirects, unsafe transport headers, unsupported legacy SSE, and
  non-portable OAuth shapes.
- The effective-rule resolver caps individual rule files at 64 KiB, effective
  content at 96 KiB, per-source content/provenance, directory depth, source
  count, and the final system instruction at 256 KiB.
- Context projection displays at most 80 active message sources and at most
  three tool/attachment children per message; older messages remain accounted
  for through the compaction/exclusion boundary.
- Automatic compaction reserves output capacity (20,000 tokens by default),
  preserves a bounded recent window and tail turns, refuses active/provider-
  native/unknown-window races, bounds its transcript to 90 messages/60,000
  characters, and commits only after provider-session stop plus generation and
  last-message revalidation.
- Git uses a 120-second default command deadline, 32 MiB combined output cap,
  bounded global/per-workspace concurrency, validated arguments, patch
  identity checks, dry-run, idempotency receipts, and explicit conflict
  results.
- Source references are capped, normalized, and confined to the selected
  workspace unless a trusted caller explicitly enables the outside-workspace
  escape hatch. Only normalized HTTP(S) external URLs are opened externally.

### Intentional adaptations and external boundaries

- Claude Terminal has no interactive per-tool callback. BetterC0de therefore
  enforces the strongest available boundary through CLI allowed/disallowed
  tool arguments, permission mode, workspace trust, bounded process handling,
  and observable JSONL events.
- ProviderHub can directly interpose only where a provider emits an approval
  or tool request. Direct OpenAI-compatible and Claude API loops use the same
  BetterC0de gate locally before execution.
- Direct Bash executes through the supervised native host shell. BetterC0de
  gates and bounds it, but it is not an operating-system sandbox; an approved
  command can access host resources outside the workspace.
- Direct MCP intentionally supports portable stdio and modern Streamable HTTP
  with static headers. Legacy SSE and interactive OAuth descriptors are
  skipped instead of dropping credentials or starting an incomplete auth flow.
  Native ACP/CLI runtimes retain their own supported transport/auth behavior.
- Starting an enabled stdio MCP server is trusted configuration and launches a
  process during discovery. Calls exposed by that process still require the
  effective tool permission.
- Provider-reported cost, cache usage, context capacity, and native
  compaction flags are projected when the provider supplies them. Catalog
  estimates remain estimates and are not presented as provider billing truth.
- Existing workspaces without a trust row are compatibility-trusted so an
  upgrade does not brick prior projects. An explicit untrusted row always
  fails closed.
- Provider-session stop and the SQLite compaction transaction cannot be one
  atomic operation. Stops complete first; failure commits nothing and blocks
  admission.
- Checkpoint undo is authoritative. Redo is intentionally unavailable because
  revert retires future refs and provider history; a renderer-only redo would
  claim state the backend no longer owns.
- The read-only reference remains design evidence only. It is ignored by
  source/build tooling and is not imported, modified, or shipped.

### Intermediate validation evidence

These runs were observed during implementation and are useful regression
evidence, but later concurrent edits mean they are not the final acceptance
run:

| Evidence | Observed result |
| --- | --- |
| Schema build | Passed. |
| UI and backend typechecks | Passed at multiple integration checkpoints; the latest direct-MCP backend typecheck passed. |
| Backend full suite checkpoint | 1,586 passed and 9 skipped before the final combined source settled. |
| Provider permission/runtime focused slice | 93 passed and 3 skipped. |
| Effective-rules/UI focused slice | 79 passed. |
| Provider events plus session/tool-tree UI slice | 86 passed. |
| Backend runtime contracts and legacy bridge slice | 43 passed. |
| Context artifact/service/route slice | 6 passed. |
| Git route guard/hunk slice | 5 passed. |
| Session/tool-tree unit slice | 8 passed. |
| Direct MCP resolver/client/adapter slice | 33 passed, including real SDK stdio and loopback Streamable HTTP. |
| ACP resolver/runtime integration slice | 73 passed. |
| Diff check | Clean at implementation checkpoints. |
| Identity/theme/dependency scans | Intermediate exact identity and added-line theme scans were clean; no dependency diff was present. |

### Final acceptance validation

**Signed off on 2026-07-24.** The settled tree passed the aggregate source gate,
33 packaging tests, 1,446 UI tests, 1,678 backend tests with 9 intentional
skips, production build/chunk/bundle audits, mobile typecheck, backend and
remote-access startup smokes, Windows packaging budgets, packaged startup and
cleanup, exact identity/theme scans, archive exclusion checks, and a real
Electron renderer inspection. Exact commands, measurements, adaptations, and
intentional boundaries are recorded in
`docs/architecture/agent-mode-parity-handover.md`.
