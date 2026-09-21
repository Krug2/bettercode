import { handleError } from "@/lib/errors/handle"
import type { EditorSaveResult } from "@/lib/editor-store"

/** UI event boundary. Store saves still reject so workflows can stop on failure. */
export async function runEditorSave(
  save: () => Promise<EditorSaveResult | readonly EditorSaveResult[] | null>
): Promise<void> {
  try {
    await save()
  } catch (error) {
    handleError(error, { source: "editor-save" })
  }
}
