# Experimental chat orchestration

The model selected in the normal chat dropdown is always the main model. Open **+ → Orchestration** to enable other providers for its agents. Available worker providers are **Claude**, **OpenAI** and **Grok**, excluding the selected main provider: with Grok 4.6 as main, the menu offers Claude and OpenAI. This also enables the experimental feature in Settings. No team creation or preassigned roles are required. Selection belongs to that chat; an unsent selection belongs to the composer draft. No provider call starts until the user sends a message.

Changing the main provider immediately changes the visible worker choices. The same shared rule filters the composer indicator, outgoing request and backend catalog so a hidden main provider cannot remain an executable worker choice. If filtering leaves no selected workers, the next message uses ordinary chat; no other provider is enabled implicitly. Saved provider preferences remain intact for a later switch back.

The backend resolves the permitted native CLI model catalog for the current project, including exact account instance IDs and project restrictions. Unavailable providers fail explicitly instead of falling back to another provider. The main model chooses whether to delegate, which model to use, each worker's name/role, and task boundaries. Multiple agents can use the same model. API-only adapters are excluded because this harness requires native CLI MCP support.

Each provider opens a supported-model list with independent model toggles and **All models**. New selections store exact provider/account/model triples, so enabling one account's Astra does not enable Sol or another account's Astra. “All models” selects the currently displayed models; models discovered later are not added silently. The backend filters its trusted catalog against this list before exposing `available_models` and admitting tasks. Missing or disallowed selections fail explicitly rather than selecting a replacement. Saved snapshots retain the model restriction across reloads and continuations. Older provider-only selections keep their previous all-model behavior until edited. The 128-model limit applies to the selected pool, not the complete provider catalog.

## Contracts and ownership

- `packages/schema/src/orchestrator.ts`: runtime-validated chat selection, sessions, jobs and shared context.
- `model-catalog.ts`: provider/account/model selection from the backend catalog and project policy.
- `service.ts`: scheduling, permissions, bounded history, cancellation and recovery. Configuration occurs under normal chat turn admission, so duplicate/rejected requests cannot reset a running team's budget. `dispatch` admits a turn; canonical provider events complete it.
- `mcp.ts`: loopback-only, HMAC-authenticated server `betterc0de_orchestrator`. Credentials belong to one thread and canonical workspace; they are never persisted. This is not an operating-system sandbox between processes running as the same user.
- `composer-orchestration.tsx`: per-chat provider selection and an active indicator in both composer layouts. Settings retains the global experimental kill switch.
- `orchestrator-team-status.tsx`: actual spawned agents, status, approval navigation, stop controls and shared context. UI lifetime does not own execution.

`available_models` returns exact model keys. `spawn_agent(modelKey, name, role, task, requestId)` starts a worker. Identical retries return the original job; conflicting retries fail. `task_status` and `wait_task` return bounded output; `cancel_task` stops one worker. Workers receive only `context_inbox`, `read_context` and `share_context`, without delegation. Every tool validates inputs and outputs with Zod. Old persisted teams and the `team_members` / `spawn_task` tools remain compatible, but the UI no longer creates fixed teams.

Workers use the ordinary chat dispatch pipeline: trusted workspace, provider policy, admission, approvals and checkpoints remain authoritative. Permissions are at most `ask-on-edit`, or `read-only` when the main request requires it. An approval changes the job to `waiting`; only the user can approve in its worker chat. Role text cannot elevate permissions.

Provider selection changes apply on the next message. Existing Codex/Grok native sessions are restarted under provider admission with their resume cursor when the orchestration MCP configuration changes; unchanged sessions are reused. Claude resolves the MCP configuration per query. The selected main model remains changeable between turns. Finish or stop outstanding workers before beginning another orchestrated turn. Disabling orchestration stops workers and restores ordinary chat; it does not permanently lock the chat. The global setting revokes capabilities immediately and cancels workers asynchronously. Failed interruption retains occupied slots and a retryable error.

## Shared threads, plans and information

**Share context** grants a snapshot to the main model, a specific spawned agent, or the whole team. Legacy teams also support grants to a configured member's future tasks. Choose a thread, its latest saved proposed plan, or a note. Only the authenticated desktop owner can grant source threads, including explicit cross-project grants.

`context-sources.ts` copies at most 100 recent visible user/assistant messages into 12,000 characters, excluding reasoning, raw tool output, attachments and hidden handoffs. Missing/empty sources fail; truncation is reported. Snapshots are immutable copies, not subscriptions. Share again to capture updates.

`context.ts` authorizes delivery and forwarding. Agents read addressed items and their own notes, write bounded notes, and forward only items they can already read within this team. A grant to one agent does not grant another agent using the same model access. The main model cannot implicitly read worker-only grants. Agents cannot fetch arbitrary source thread IDs. Every tool call rechecks feature enablement, workspace trust, scope and task state. Worker access expires on completion or cancellation.

The UI shows provenance, recipient, truncation and fetch receipts. Fetching does not prove understanding. Sharing does not interrupt an active call, wake a completed worker or start a paid turn. The main model must spawn another agent for follow-up work. Up to 64 context items are persisted; idempotent writes roll back in memory on persistence failure. Removal deletes a snapshot and its forwards, but cannot erase already fetched text from provider conversations. Polls return metadata, not context bodies or full worker output.

## Bounds and recovery

Each selected account/model has its own **Thinking** setting. **Auto** (an omitted or null `reasoningEffort`) uses the provider default; it does not disable thinking. Manual values must match the model's advertised `effort` or `reasoningEffort` descriptor. Missing capabilities allow Auto only. The backend revalidates the selected level on each main turn and rejects stale values before replacing the session. Selections survive chat persistence and continuation. Workers receive both the common reasoning field and the descriptor's exact model-selection option, including for Grok ACP. The main model can see the fixed level in `available_models` but cannot change it through `spawn_agent`.

Chat orchestration permits up to 128 available models, two concurrent workers per chat, eight active workers globally, and twelve newly spawned tasks per main turn. It retains up to twenty previous jobs plus the current turn's jobs. Legacy teams retain their saved concurrency and lifetime task limits. There are at most 24 cached sessions, a 15-minute worker timeout and 24,000 output characters per task. These limits are not a monetary spending cap.

Snapshots use the indexed reserved activity ID `orchestrator:<threadId>`. Restart marks unfinished work `interrupted` without replaying model calls. Deletion, retention, worktree teardown and shutdown stop dependent work first.

Workers share the project. The main model is instructed to assign disjoint files, supply context, collect results and review combined changes. There is no file-level write isolation or automatic Git merge; provider-native agent tools remain available. Real CLI availability and the model's decision to delegate require an account-backed end-to-end run. Deterministic tests cover scheduling, scoped MCP calls, context access and native adapter start/resume configuration without paid model calls.

Run `npm test -w @betterc0de/backend -- src/services/orchestrator`. Provider bridge tests additionally cover Claude SDK options, Codex start/resume overrides, Grok ACP scoping and ProviderHub capability refresh.
