/**
 * Git service: the backend's only way to run `git`. Split by concern;
 * this index keeps `services/git` as the single import for callers.
 */

export * from "./process"
export * from "./profile"
export * from "./refs"
export * from "./status"
export * from "./commands"
export * from "./diff"
export * from "./worktrees"
export * from "./checkpoints"
