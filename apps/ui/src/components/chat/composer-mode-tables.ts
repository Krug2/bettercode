/**
 * Shared data tables for composer picker menus.
 *
 * Both `composer-full-footer.tsx` and `composer-minimal-footer.tsx`
 * used to inline the permission-levels list with slight description
 * drift between them. Centralizing here means a wording change or
 * adding a level is a one-file edit, and both footers stay in sync.
 *
 * Not every picker has a static table — thinking-mode options are
 * provider-aware (Opus 4.7 vs Claude vs non-Claude have different
 * labels), so they stay inline where they're computed. Chat-mode and
 * special-mode menus also include per-option rich tooltips with
 * provider-conditional styling, which is easier to read co-located
 * with their renderer than routed through a config file.
 */

import type { PermissionLevel } from "@/lib/preferences-store"

export type PermissionLevelOption = {
  id: PermissionLevel
  label: string
  desc: string
  danger: boolean
}

/**
 * The permission presets the UI exposes, in menu order: from the one that
 * asks about everything to the one that asks about nothing, with the
 * reach-limiting preset before the unguarded one.
 *
 * The menu keeps the app greys; the destructive colour marks the one preset
 * that removes the guardrails, so it still means something when it shows up.
 */
export const PERMISSION_LEVELS: readonly PermissionLevelOption[] = [
  {
    id: "ask-on-edit",
    label: "Ask first",
    desc: "Approve every command and file change",
    danger: false,
  },
  {
    id: "allow-edits",
    // Was labelled "Full Access" with "auto-approves reads, writes, and
    // commands" — which the gate never did: `evaluatePermission` only
    // auto-allows the `write` class here, and commands still ask. The label
    // promised more permission than the code grants.
    label: "Auto-edit",
    desc: "Files change on their own · commands still ask",
    danger: false,
  },
  {
    id: "default",
    label: "Auto Mode",
    desc: "Routine work runs · anything unusual asks",
    danger: false,
  },
  {
    id: "read-only",
    label: "Read-only",
    desc: "Search and read · never modifies anything",
    danger: false,
  },
  {
    id: "bypass",
    label: "Bypass Permission",
    desc: "Everything runs unattended · no guardrails",
    danger: true,
  },
] as const

/**
 * The label for one preset, for the always-visible composer chip.
 *
 * Derived from the same table the menu renders so the two cannot disagree —
 * the chip used to carry its own hand-written wording and said "Full access"
 * for the preset the menu called something else entirely.
 */
export function permissionLevelLabel(id: string | null | undefined): string {
  const key = id?.trim()
  return (
    PERMISSION_LEVELS.find((level) => level.id === key)?.label ??
    PERMISSION_LEVELS[0]!.label
  )
}

/** Copy shown in the confirmation dialog before enabling Bypass mode. */
export const BYPASS_CONFIRM_TITLE = "Enable Bypass mode?"
export const BYPASS_CONFIRM_BODY =
  "The assistant will run shell commands, edit files, and read files " +
  "WITHOUT asking for approval — for any provider. Only use this in " +
  "trusted workspaces."
