/**
 * Unified provider event handler: the single source of truth for every event
 * source (WS push, Electron IPC for the Claude SDK, plugin events). The
 * implementation follows the event through `normalize` → `handle`, which
 * fans out to `activities`, `delta-coalescing` and `turn-artifacts`; only
 * this surface is imported from outside the folder.
 */

export { handleProviderEvent, type ProviderEventCallbacks } from "./handle"
export { flushPendingDeltas } from "./delta-coalescing"
