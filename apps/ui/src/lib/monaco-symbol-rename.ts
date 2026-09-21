import type * as Monaco from "monaco-editor"
import {
  captureEditorDocument,
  useEditorStore,
  type EditorChangeResult,
} from "@/lib/editor-store"
import {
  planSymbolRename,
  type RenameDocument,
} from "@/lib/editor-symbol-rename"
import { editorModelUri, workspaceRelativeEditorPath } from "@/lib/editor-path"

export type OpenFilesRenameResult =
  | (Extract<EditorChangeResult, { status: "applied" }> & {
      readonly replacements: number
    })
  | Extract<EditorChangeResult, { status: "conflict" }>
  | { readonly status: "rejected"; readonly reason: string }

/** Open TS/JS buffers only. All read dependencies must still match at commit. */
export async function renameSymbolInOpenFiles(input: {
  readonly monaco: typeof Monaco
  readonly model: Monaco.editor.ITextModel
  readonly expectedModelVersion: number
  readonly projectPath?: string | null
  readonly filePath: string
  readonly offset: number
  readonly newName: string
}): Promise<OpenFilesRenameResult> {
  const { monaco, model } = input
  const reject = (reason: string): OpenFilesRenameResult => ({
    status: "rejected",
    reason,
  })
  if (!["typescript", "javascript"].includes(model.getLanguageId()))
    return reject(
      "Semantic rename supports open TypeScript and JavaScript files only."
    )
  if (model.isDisposed() || model.getVersionId() !== input.expectedModelVersion)
    return reject("The document changed. Reopen Rename.")
  const tabs = useEditorStore
    .getState()
    .tabs.filter(
      (tab) =>
        !tab.diff &&
        !tab.isLoading &&
        (tab.fileKind ?? "text") === "text" &&
        ["typescript", "javascript"].includes(tab.language) &&
        (!input.projectPath ||
          workspaceRelativeEditorPath(input.projectPath, tab.filePath) !== null)
    )
  const current = tabs.find((tab) => tab.filePath === input.filePath)
  if (!current || current.content !== model.getValue())
    return reject("The selected buffer changed. Reopen Rename.")
  const ownedModels: Monaco.editor.ITextModel[] = []
  const observedModels: Array<{
    model: Monaco.editor.ITextModel
    version: number
  }> = []
  const documents: RenameDocument[] = []
  try {
    for (const tab of tabs) {
      const uri =
        tab.id === current.id
          ? model.uri
          : monaco.Uri.parse(editorModelUri(tab.filePath))
      let documentModel = monaco.editor.getModel(uri)
      if (!documentModel) {
        documentModel = monaco.editor.createModel(
          tab.content,
          tab.language,
          uri
        )
        ownedModels.push(documentModel)
      }
      if (documentModel.getValue() !== tab.content)
        return reject("An open editor is still synchronizing. Retry Rename.")
      observedModels.push({
        model: documentModel,
        version: documentModel.getVersionId(),
      })
      documents.push({
        uri: uri.toString(),
        snapshot: captureEditorDocument(tab),
      })
    }
    const getWorker =
      model.getLanguageId() === "typescript"
        ? await monaco.languages.typescript.getTypeScriptWorker()
        : await monaco.languages.typescript.getJavaScriptWorker()
    const worker = await getWorker(
      ...observedModels.map((item) => item.model.uri)
    )
    const plan = await planSymbolRename({
      worker,
      documents,
      currentUri: model.uri.toString(),
      offset: input.offset,
      newName: input.newName,
    })
    if (plan.status === "rejected") return plan
    if (
      observedModels.some(
        (item) =>
          item.model.isDisposed() || item.model.getVersionId() !== item.version
      )
    )
      return reject(
        "An open document changed during Rename. Nothing was changed; retry."
      )
    const result = useEditorStore
      .getState()
      .applyDocumentChanges(plan.changes, plan.guards)
    return result.status === "applied"
      ? { ...result, replacements: plan.replacements }
      : result
  } finally {
    // A pane may have mounted while the worker ran; it now owns its model.
    const mounted = new Set(
      monaco.editor.getEditors().map((editor) => editor.getModel())
    )
    ownedModels.forEach((owned) => {
      if (!mounted.has(owned)) owned.dispose()
    })
  }
}
