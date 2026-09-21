import type React from "react"
import { ChevronDownIcon, SquareIcon } from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMicIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { PromptInputButton } from "@/components/ai-elements/prompt-input"

type VoiceInputControlProps = {
  isRecording: boolean
  voiceSetupComplete: boolean
  size?: "icon-xs" | "icon-sm"
  onClick?: React.ComponentProps<typeof PromptInputButton>["onClick"]
  onContextMenu?: React.ComponentProps<
    typeof PromptInputButton
  >["onContextMenu"]
  onOpenSettings?: () => void
}

/**
 * Microphone button for the prompt input.
 *
 * Visual states:
 *  - idle: muted surface, AI-mic icon
 *  - needs-setup: amber dot in the corner — the click still works (it opens
 *    setup), the dot just says "this isn't configured yet"
 *  - recording: red ring with a pulsing ping animation (three staggered
 *    rings for a radar-ish feel)
 *
 * When `onOpenSettings` is provided the control becomes a split button: mic
 * on the left, a chevron segment on the right sharing one outline. It used to
 * be a free-floating circular badge pinned over the button's top-right
 * corner, which only appeared on hover and read as a rendering artifact
 * rather than a control. The chevron segment is hidden while recording so it
 * can't be misclicked.
 */
export function VoiceInputControl({
  isRecording,
  voiceSetupComplete,
  size = "icon-sm",
  onClick,
  onContextMenu,
  onOpenSettings,
}: VoiceInputControlProps) {
  const isCompact = size === "icon-xs"
  const label = isRecording
    ? "Stop recording"
    : voiceSetupComplete
      ? "Voice input"
      : "Setup voice input"
  const hasSettings = !!onOpenSettings && !isRecording
  const radius = isCompact ? "rounded-xl" : "rounded-2xl"

  // Shared skin so the mic and the chevron segment read as one control.
  const surface = isRecording
    ? "border-red-500/45 bg-red-500/12 text-red-500 hover:border-red-500/60 hover:bg-red-500/18 hover:text-red-600"
    : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"

  return (
    <div className="group/mic inline-flex items-center">
      <div
        className={cn(
          "relative inline-flex items-center justify-center",
          isCompact ? "size-6" : "size-8"
        )}
      >
        {isRecording &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "absolute inset-0 animate-ping border border-red-500/30",
                radius
              )}
              style={{
                animationDelay: `${i * 0.3}s`,
                animationDuration: "2s",
              }}
            />
          ))}
        <PromptInputButton
          aria-label={label}
          aria-pressed={isRecording}
          tooltip={label}
          size={size}
          onClick={onClick}
          onContextMenu={onContextMenu}
          className={cn(
            "relative z-10 shrink-0 border shadow-sm transition-[color,background-color,border-color,box-shadow]",
            radius,
            surface,
            hasSettings && "rounded-r-none border-r-0"
          )}
        >
          {isRecording ? (
            <SquareIcon
              strokeWidth={2}
              className={cn(
                "fill-current stroke-current",
                isCompact ? "size-2.5" : "size-3"
              )}
            />
          ) : (
            <HugeiconsIcon
              icon={AiMicIcon}
              strokeWidth={2}
              className={isCompact ? "size-4" : "size-[18px]"}
            />
          )}
        </PromptInputButton>
        {/* Not-configured hint. Silent until the user looks at it — the
            button's own tooltip already says "Setup voice input". */}
        {!voiceSetupComplete && !isRecording && (
          <span
            aria-hidden
            className="absolute -top-px -right-px z-20 size-1.5 rounded-full bg-amber-500 ring-2 ring-background"
          />
        )}
      </div>
      {hasSettings && (
        <PromptInputButton
          aria-label="Voice settings"
          tooltip="Voice settings"
          size={size}
          onClick={onOpenSettings}
          className={cn(
            "z-10 shrink-0 border px-0 shadow-sm transition-[color,background-color,border-color,box-shadow]",
            radius,
            surface,
            "rounded-l-none",
            isCompact ? "w-4" : "w-5"
          )}
        >
          <ChevronDownIcon
            className={isCompact ? "size-2.5" : "size-3"}
            strokeWidth={2.25}
          />
        </PromptInputButton>
      )}
    </div>
  )
}
