import { useEffect } from "react"
import {
  isEditableElementTarget,
  isInteractiveClickTarget,
  playUiClickSound,
  playUiTypingSound,
  preloadUiSoundThemes,
  shouldPlayTypingSound,
} from "@/lib/ui-sound"

/**
 * Wires up the per-key / per-click UI sound effects.
 *
 * Three effects bundled together:
 *  1. **Preload** — eagerly fetches the currently-selected keyboard and
 *     mouse theme packs so the first keystroke doesn't wait on I/O.
 *  2. **Typing sounds** — listens globally for `keydown`/`keyup` inside
 *     editable elements, playing the matching "down" / "up" sample. Uses
 *     capture-phase listeners so IME/combo keys register before the
 *     normal propagation reaches child components.
 *  3. **Click sounds** — left-button and right-button separately, in both
 *     phases, but only on elements that look interactive
 *     (`isInteractiveClickTarget` filters out random divs/text nodes).
 *
 * The whole thing no-ops when sounds are disabled at any level, so the
 * cost of being mounted with sounds off is just a handful of cheap state
 * reads.
 */
export function useUiSounds({
  uiSoundEnabled,
  uiSoundTypingEnabled,
  uiSoundClicksEnabled,
  uiSoundKeyUpEnabled,
  uiSoundKeyboardTheme,
  uiSoundMouseTheme,
  uiSoundVolume,
}: {
  uiSoundEnabled: boolean
  uiSoundTypingEnabled: boolean
  uiSoundClicksEnabled: boolean
  uiSoundKeyUpEnabled: boolean
  uiSoundKeyboardTheme: string
  uiSoundMouseTheme: string
  uiSoundVolume: number
}) {
  useEffect(() => {
    preloadUiSoundThemes(uiSoundKeyboardTheme, uiSoundMouseTheme).catch(
      () => {}
    )
  }, [uiSoundKeyboardTheme, uiSoundMouseTheme])

  useEffect(() => {
    if (!uiSoundEnabled || !uiSoundTypingEnabled) return

    const handleTypingDown = (event: KeyboardEvent) => {
      if (!shouldPlayTypingSound(event)) return
      if (!isEditableElementTarget(event.target)) return
      playUiTypingSound({
        keyboardThemeId: uiSoundKeyboardTheme,
        volume: uiSoundVolume,
        phase: "down",
      }).catch(() => { /* Expected: audio playback may fail (autoplay policy, missing asset) */ })
    }

    const handleTypingUp = (event: KeyboardEvent) => {
      if (!uiSoundKeyUpEnabled) return
      if (!shouldPlayTypingSound(event)) return
      if (!isEditableElementTarget(event.target)) return
      playUiTypingSound({
        keyboardThemeId: uiSoundKeyboardTheme,
        volume: uiSoundVolume,
        phase: "up",
      }).catch(() => { /* Expected: audio playback may fail (autoplay policy, missing asset) */ })
    }

    window.addEventListener("keydown", handleTypingDown, true)
    window.addEventListener("keyup", handleTypingUp, true)

    return () => {
      window.removeEventListener("keydown", handleTypingDown, true)
      window.removeEventListener("keyup", handleTypingUp, true)
    }
  }, [
    uiSoundEnabled,
    uiSoundTypingEnabled,
    uiSoundKeyUpEnabled,
    uiSoundKeyboardTheme,
    uiSoundVolume,
  ])

  useEffect(() => {
    if (!uiSoundEnabled || !uiSoundClicksEnabled) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!isInteractiveClickTarget(event.target)) return
      if (event.button === 0) {
        playUiClickSound({
          mouseThemeId: uiSoundMouseTheme,
          volume: uiSoundVolume,
          kind: "left-down",
        }).catch(() => { /* Expected: audio playback is best-effort */ })
      } else if (event.button === 2) {
        playUiClickSound({
          mouseThemeId: uiSoundMouseTheme,
          volume: uiSoundVolume,
          kind: "right-down",
        }).catch(() => { /* Expected: audio playback is best-effort */ })
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (!isInteractiveClickTarget(event.target)) return
      if (event.button === 0) {
        playUiClickSound({
          mouseThemeId: uiSoundMouseTheme,
          volume: uiSoundVolume,
          kind: "left-up",
        }).catch(() => { /* Expected: audio playback is best-effort */ })
      } else if (event.button === 2) {
        playUiClickSound({
          mouseThemeId: uiSoundMouseTheme,
          volume: uiSoundVolume,
          kind: "right-up",
        }).catch(() => { /* Expected: audio playback is best-effort */ })
      }
    }

    document.addEventListener("mousedown", handleMouseDown, true)
    document.addEventListener("mouseup", handleMouseUp, true)

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true)
      document.removeEventListener("mouseup", handleMouseUp, true)
    }
  }, [
    uiSoundEnabled,
    uiSoundClicksEnabled,
    uiSoundMouseTheme,
    uiSoundVolume,
  ])
}
