# Provider display and home layout

Command presentation lives in `packages/schema/src/command-display.ts` and is
shared by desktop and mobile tool activity. Structured argument lists retain
their boundaries; string commands use a small boundary reader that recognizes
shell switches and their option values. Unknown invocations are displayed in
full. This is a display formatter, never an execution parser or permission check.

The desktop provider update notice has a pure session reducer in
`apps/ui/src/lib/provider-update-session.ts`. It captures a cutoff when the first
timestamped provider snapshot arrives, projects current update results, and keeps
dismissals across refreshes. Dismiss events carry the displayed result's key so
an old timer cannot dismiss a newer update. The component owns timer setup and
cleanup, while the existing notification builder owns provider grouping and text.

Codex authentication overlays retain the adapter's existing layout contract and
continuation identity. `CodexHomeLayout.ts` first resolves filesystem identities
and builds a complete link plan. It rejects overlapping roots, linked auth files
and conflicting destination entries before applying the plan. Missing entries
are distinguished from filesystem failures; permission and I/O errors propagate.
Runtime file names remain the names required by Codex. Applying a plan is not a
filesystem transaction: an I/O failure during application may require another
attempt, which reuses correct links and repairs stale links without deleting
their targets.

Tailscale CLI diagnostics normalize whitespace and terminal color sequences
before mapping errors to public labels. Neither the original stderr nor the
normalized text is returned to a client, since it may include credentials.
