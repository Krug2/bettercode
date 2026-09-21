import { useAppearanceStore } from "@/lib/appearance-store"

/**
 * Bundles the 10 appearance-store selectors App.tsx needs into one
 * hook so they can be destructured in a single statement.
 *
 * Individual selectors (not an object return from zustand) so each
 * primitive field gets its own subscription and zustand's default
 * equality check can bail out re-renders when only *other* fields
 * change. Returning a single object from one selector would break that.
 */
export function useAppearanceState() {
  const activeTemplate = useAppearanceStore((s) => s.template)
  const chatUiStyle = useAppearanceStore((s) => s.chatUiStyle)
  const uiSoundEnabled = useAppearanceStore((s) => s.uiSoundEnabled)
  const uiSoundTypingEnabled = useAppearanceStore(
    (s) => s.uiSoundTypingEnabled
  )
  const uiSoundClicksEnabled = useAppearanceStore(
    (s) => s.uiSoundClicksEnabled
  )
  const uiSoundKeyUpEnabled = useAppearanceStore((s) => s.uiSoundKeyUpEnabled)
  const uiSoundKeyboardTheme = useAppearanceStore(
    (s) => s.uiSoundKeyboardTheme
  )
  const uiSoundMouseTheme = useAppearanceStore((s) => s.uiSoundMouseTheme)
  const uiSoundVolume = useAppearanceStore((s) => s.uiSoundVolume)
  const setAppearance = useAppearanceStore((s) => s.set)
  return {
    activeTemplate,
    chatUiStyle,
    uiSoundEnabled,
    uiSoundTypingEnabled,
    uiSoundClicksEnabled,
    uiSoundKeyUpEnabled,
    uiSoundKeyboardTheme,
    uiSoundMouseTheme,
    uiSoundVolume,
    setAppearance,
    minimalChat: chatUiStyle === "simple",
  }
}
