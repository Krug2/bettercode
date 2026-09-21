import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand a leading "~" in user-supplied paths. Spawned provider CLIs do not
 * get shell expansion, so settings like "~/.codex-work" must be resolved here.
 */
export function expandHomePath(value: string): string {
  if (!value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}
