export const EDITOR_PREVIEW_TOGGLE_EVENT = "betterc0de:editor-toggle-preview"
export const EDITOR_FILE_ACTIVATE_EVENT = "betterc0de:editor-file-activate"

export function dispatchEditorFileActivate(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EDITOR_FILE_ACTIVATE_EVENT))
}
export const BROWSER_PREVIEW_COMMAND_EVENT =
  "betterc0de:browser-preview-command"

export type BrowserPreviewCommand =
  | "reload-page"
  | "focus-url-bar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"

export interface BrowserPreviewCommandEventDetail {
  command: BrowserPreviewCommand
}

export function dispatchEditorPreviewToggle(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(EDITOR_PREVIEW_TOGGLE_EVENT))
}

export function dispatchBrowserPreviewCommand(
  command: BrowserPreviewCommand
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<BrowserPreviewCommandEventDetail>(
      BROWSER_PREVIEW_COMMAND_EVENT,
      { detail: { command } }
    )
  )
}
