# Editor workspace

Editor mode uses a workspace sidebar, a code surface, and a resizable chat
surface. The sidebar switches between Files, Search, and Git; the menu also
exposes outline, code map, and references. It uses the same surface tokens and
menu primitives as Agent mode. Agent mode retains its existing pane grid.
The editor's left sidebar and right chat share inset rounded borders and the
same dark surface. The center retains the lighter shell background in dark
mode, including the file overview and Monaco editor.
Open Files, the workspace tree, and Recent Files use independent collapsible
headers with counts. The workspace header remains reachable while scrolling;
its creation icons stay available when collapsed and reopen the tree when used.
Reveal in Explorer
reopens the workspace and preserves expanded child folders. Agent file panes
and the File Explorer dialog also allow the workspace tree to collapse.
Their expanded state is saved in local renderer storage and survives changing
sidebar views. File actions use the existing editor store and dirty-file
confirmation; recent files reopen at their remembered cursor position.
Tree rows are 28 px high with 12 px labels and 18 px icons, increasing to
13 px labels and 20 px icons on large displays. Creation and rename inputs
follow the same sizing; Open Files and Recent Files use 13 px file names.

Material Icon Theme is pinned as a development dependency. `npm run icons:sync`
copies the official SVGs and MIT license into `apps/ui/public/file-icons` and
generates the checked-in association table. The renderer uses the shared
`file-icons.ts` resolver for specific names, path suffixes, compound extensions,
and expanded folder variants, including the system file browser. Generated CSS
selects the official light icon variants using the app's theme class. No extension
runtime or network icon fetch runs in the app.
Monaco keeps its local HTML, JavaScript/TypeScript, JSON, and CSS workers.
Additional JSON MIME aliases enable JSON-LD and import-map tokenization inside
HTML. The first embedded JSON encounter initializes Monaco's JSON tokenizer
through a temporary empty model, which is immediately disposed. Workbench
syntax rules distinguish tags, attributes, keywords, strings,
numbers, and JSON keys in dark and light modes without changing editor surfaces.

The shared desktop `DiffPanel` uses the active background and semantic theme
tokens in Editor, Agent, and workspace panes. `diff-syntax.ts` lazily loads the
existing Shiki highlighter for the selected file, tokenizes old/new revisions
separately, and keeps both theme palettes. Large files skip tokenization; source
text and independently applicable hunk patches remain intact. `DiffHunkLines`
renders paired cells in shared grid rows so wrapping cannot misalign revisions.
The file list uses `diffFileListWidth` in renderer preferences. Pointer capture
keeps divider drags inside the panel; only completed drags persist the width.
Cancellation or closing the list discards the temporary width. A ResizeObserver
clamps the visible width to the containing pane while preserving the saved
preference for larger panes. At narrow widths the list remains horizontal and
the divider is hidden. Scoped scrollbar parts follow the active theme without
Chromium's native `scrollbar-width: thin` override.
Stage, Discard, and Unstage still use the existing backend Git routes and their
permission, trust, conflict, and idempotency checks. Mobile has a separate diff
view and does not consume this desktop component.

The shared project tree supports internal drag-and-drop in Editor, Agent panes,
and the File Explorer dialog. A directory row's center targets that directory;
its top and bottom 8 px target the parent, with an insertion line at that depth.
File rows target their parent, and the workspace header targets the root.
Entries retain alphabetical sorting. Only hovering inside a target opens it
after 500 ms; moving to an edge cancels expansion. Row action icons are hidden
during dragging so the full width is available. External drags, moves to the
current parent, and moves into the source's descendants are ignored. Moves use
the existing `/workspace/move` route and its trust and checkpoint recovery gates.
The backend rejects occupied destinations with 409 before renaming and rejects
descendant destinations before creating parent directories. On success, the
editor store rebases open buffers, recent files, and navigation history; the tree
refreshes and reveals the destination. Failures leave editor paths unchanged and
appear in the tree. Mobile has no equivalent draggable project tree.

Workspace identity comes from the selected thread's runtime path, including
worktrees. Recent workspace choices come from loaded conversation history.
When entering the editor without a project, `useEditorWorkspace` waits for
history and restores the last known workspace and selected conversation.
An explicit editor launch folder takes precedence and is resolved after
history loads, avoiding duplicate threads on reload.

The editor stores its last workspace path and chat layout metadata in local
renderer storage. Layout metadata contains tab IDs, thread IDs, labels, and
the selected split. Messages and activities remain in the backend's existing
persistence and journal paths. This does not persist code buffers or replace
the thread history service. Invalid layout metadata falls back to a fresh tab.
Saved chats absent from loaded history remain visibly unavailable and cannot
accept messages until reopened from history.

Editor chat panels always use a single-column stack, with a minimum row height
and vertical scrolling in short windows. Top/bottom tab drop zones reorder that
stack. Adding an ordinary chat selects it in a single panel. The layout menu
and tab context menus enter and leave stacked views without deleting conversations.
Empty chats place their flexible spacer above the composer; populated chats use
the scrolling transcript there. The composer does not shrink. Tab titles size to
their content, shortcuts are in tooltips, and New chat/layout actions sit outside
the scrolling tab strip. The Agent mode pane grid retains its own layout.

The workspace overview and Files view retain bounded recursive scans. A
separate root directory listing keeps top-level folders reachable when the
scan is capped; expanding folders uses the existing backend directory reader.
Counts indicate truncation, and failed loads offer a retry.
The overview groups project identity, search and preview actions, scan counts,
key files, and a file-type breakdown using the existing theme tokens. Container
queries stack these sections according to the editor pane's width. The chart
uses all scanned files as its denominator; file types omitted from the summary
and files without extensions remain represented in a remaining-files segment.
This is renderer presentation only; scan limits and workspace authorization are
unchanged.

The Code Map sidebar uses the existing `/workspace/map` response, with a pinned
workspace summary and separate Overview/Files views. Folder filters match path
boundaries (including a distinct root-only filter), then combine with text and
kind filters; filter counts describe the current folder/search scope. The index
still renders at most 80 rows and asks the user to refine larger result sets.
Collapsible summary sections and type expansion remain local UI state. Workspace
changes remount the map so old selections and filters cannot carry into another
project. File open/reveal and brief copying retain their existing APIs; the
backend scan limits and trust checks are unchanged. The map is desktop-only,
shared by the sidebar and command-palette entry point, with no provider or
mobile contract changes.

Monaco stays lazy loaded. Editor panes use named themes and temporarily enable
JSX parsing, retaining diagnostics. Language defaults are restored when the
last editor pane closes, preserving the Agent file modal's configuration.
Search target positions are recovered from the tab store when a lazy editor
mounts after the navigation event.

The browser shares the file tab strip and stays mounted when switching back
to a file. Its last URL is saved per workspace; desktop history follows the
guest page's actual navigation. The element inspector starts collapsed.

Desktop element selection uses a host overlay above the isolated webview.
Pointer and keyboard picks never reach the guest page. The overlay reads a
bounded snapshot (URL, selector, tag, label and text) and scrolls the inspected
page on wheel input. It does not collect input values or raw HTML. Design's
select tool uses the same overlay; Browse in the editor removes it. The
sandboxed iframe fallback retains browsing but does not offer element picking.

`ElementInspector` owns only inspector presentation and filtering. The parent
preview panel keeps selection, tab and pending CSS state. Tree filtering retains
ancestors and selectors; keyboard navigation and preview picks use the same
selection callback. Inspector surfaces and scrollbars use the app theme tokens.
No new page reads, navigation permissions or workspace access paths are added.

The Styles inspector uses shared numeric controls for Design and CSS views.
Pointer capture keeps scrubbing active outside the field, and preview updates
are limited to one per animation frame while dragging. Escape, pointer
cancellation, and window blur restore the starting value; cleanup releases
capture and global listeners. CSS units are preserved, unsupported expressions
remain editable as text, and each spacing side is independent. Pending edits
coalesce by selector/property and disappear when restored to their original
value. Style changes stay in the existing preview transport and Send to AI
path; the inspector never writes workspace files directly.

Draft element references are scoped to a thread, deduplicated by URL and
selector, and capped at 16 per message. Sending captures the originating
thread's picks; a failed send retains them, and a successful send removes
only that captured set. Tags added meanwhile or in another chat survive.
Draft references use bounded local renderer storage. Sent references use the
existing attachment metadata contract and durable chat dispatch lane, so
desktop and mobile can show tags again after reload. Provider dispatch filters
these metadata attachments from native file inputs; selected elements enter
the prompt and restored history as explicitly untrusted reference text.

Filesystem, search, replacements, Git, and provider dispatch continue to use
the backend APIs and existing permission and trust checks. No adapter-specific
selection API, new message write path, or shell bridge is introduced.

## Queued composer drafts

The desktop composer stores unsent follow-ups in `message-queue-store`, using
the same local renderer storage boundary as draft element references. Enqueue
persists before acknowledging submission, so a full storage quota leaves the
original draft intact. Text, converted attachments and browser references are
captured together; later selections are not consumed when a queued draft sends.

One app-level queue runner watches turn completion for every queued thread,
independently of pane focus. A persisted claim prevents duplicate delivery by
multiple subscriptions. Each entry uses a stable user-message ID and timestamp
through the existing chat submission and backend dispatch receipt lane. Only
definitive busy responses are retried automatically; other failures pause the
thread's queue. Restarted queues require explicit Resume, including interrupted
claims whose delivery may already have reached the provider. Stop pauses queued
drafts before the local stream finalizes, and queued input takes precedence over
automatic autonomous-loop continuation.

This is a desktop composer feature, shared by Agent, Editor and Design views.
It works with every adapter through normal chat dispatch and current thread
permissions; it does not add provider-specific steering, a backend scheduler,
or a mobile queue. The existing mobile dispatch contract is unchanged.

## Skills in the slash picker

The shared desktop composer lists enabled provider skill metadata alongside
built-in, project and provider commands, with All/Commands/Skills filters.
Selecting a provider skill inserts its existing native `$skill` token. A typed
`/skill` alias is resolved in `chat-submit/input-context` before local command
dispatch, preserving the visible user text. Built-ins and native provider
commands take precedence over aliases; runtime/project skill routing is unchanged.
The command ladder remains in `slash-command-runtime` and the normal submission
lane still owns permissions, queues and message persistence.

Claude, Codex, Claude Terminal and BetterC0de-compatible providers reuse the same
native skill path as the `$` picker. Cursor and Grok expose skills here only if
their provider metadata contains them; commands are not inferred to be skills.
This changes no adapter protocol or HTTP contract and reads no skill files in
the renderer. Mobile has no equivalent slash picker; its dispatch is unchanged.

## Settings compatibility and checkpoint context

The shared settings schema normalizes legacy `null` values only for optional
string fields. Its output stays `string | undefined`; required fields, invalid
types and undecryptable secrets retain the existing write protection. Loading
does not rewrite a file solely for this normalization. The normal validated,
locked settings save persists the canonical form and preserves encrypted keys.
Both desktop and mobile continue using the same redacted settings contract.

The desktop settings store reports and rolls back failed saves, and attaches a
rejection handler for controls that do not await the result. It returns the
original promise so awaited workflows can still stop after a failed save.

File checkpoints capture the originating thread's runtime path at stream
finalization and carry it through asynchronous file reads to the branch lookup.
They never default to the backend process directory or the currently focused
chat. Registration and workspace trust enforcement remain on the backend.
This applies to every provider through shared desktop finalization; mobile uses
backend checkpoints and has no corresponding renderer file-checkpoint path.
