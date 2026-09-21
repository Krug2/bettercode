export const EDITOR_REVEAL_FILE_EVENT = "betterc0de:editor-reveal-file"

export interface EditorRevealFileEventDetail {
  filePath?: string
}

export function dispatchEditorRevealFile(
  filePath: string,
  options: { defer?: boolean } = {}
): void {
  const emit = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent<EditorRevealFileEventDetail>(EDITOR_REVEAL_FILE_EVENT, {
        detail: { filePath },
      })
    )
  }

  if (options.defer && typeof window !== "undefined") {
    window.setTimeout(emit, 0)
    return
  }

  emit()
}
