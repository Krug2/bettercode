import {
  CheckIcon,
  CircleHelpIcon,
  EyeIcon,
  PencilIcon,
  ShieldOffIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PermissionLevelOption } from "@/components/chat/composer-mode-tables"

/**
 * One row of the permission menu, shared by both composer footers.
 *
 * Lives here rather than in each footer because the two copies had already
 * drifted once into describing the same setting differently.
 *
 * Two lines, one accent. The names alone cannot carry the distinction that
 * matters most — "Auto-edit" and "Adaptive" both sound permissive, and only
 * the second line says which one still stops for a command. Everything else
 * stays in the menu's own greys: an earlier version tinted each row a
 * different colour, which made a five-item picker louder than the app around
 * it. The destructive colour is reserved for the one preset that removes the
 * guardrails, so it still means something when it appears.
 */

/**
 * Plain line icons, one shape per idea, no decoration.
 *
 * Exported so the composer chip can show the icon of the preset that is
 * actually active. It used to show a generic shield for all five, which meant
 * the chip and the checked row in its own menu disagreed about what the
 * setting looks like.
 */
export function permissionIcon(id: string) {
  switch (id) {
    // A question: this mode stops and asks.
    case "ask-on-edit":
      return CircleHelpIcon
    // A pencil: edits land by themselves.
    case "allow-edits":
      return PencilIcon
    case "read-only":
      return EyeIcon
    // A shield switched off — the guardrails are gone, not merely loosened.
    case "bypass":
      return ShieldOffIcon
    // Sliders: the provider tunes it per action.
    default:
      return SlidersHorizontalIcon
  }
}

export function PermissionMenuRow({
  option,
  active,
}: {
  option: PermissionLevelOption
  active: boolean
}) {
  const Icon = permissionIcon(option.id)
  const danger = option.danger

  return (
    <>
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0 self-start",
          danger ? "text-destructive" : "text-muted-foreground"
        )}
        strokeWidth={1.75}
      />

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] leading-tight font-medium",
            danger ? "text-destructive" : "text-foreground/95"
          )}
        >
          {option.label}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-[11.5px] leading-snug",
            danger ? "text-destructive/75" : "text-muted-foreground"
          )}
        >
          {option.desc}
        </span>
      </span>

      <CheckIcon
        className={cn(
          "size-3.5 shrink-0 self-center",
          danger ? "text-destructive" : "text-primary",
          active ? "opacity-100" : "opacity-0"
        )}
        strokeWidth={2.5}
      />
    </>
  )
}
