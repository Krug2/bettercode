import { z } from "zod"
import type {
  EditorDocumentChange,
  EditorDocumentSnapshot,
} from "@/lib/editor-store"
import { isRenameableIdentifier } from "@/lib/symbol-rename"

/** The worker's public typings return any. Validate that boundary before editing. */
export interface SymbolRenameWorker {
  getRenameInfo(
    fileName: string,
    position: number,
    options: { allowRenameOfImportPath: false }
  ): Promise<unknown>
  findRenameLocations(
    fileName: string,
    position: number,
    findInStrings: false,
    findInComments: false,
    providePrefixAndSuffixTextForRename: true
  ): Promise<unknown>
}
export interface RenameDocument {
  readonly uri: string
  readonly snapshot: EditorDocumentSnapshot
}
export type SymbolRenamePlan =
  | {
      readonly status: "ready"
      readonly changes: readonly EditorDocumentChange[]
      readonly guards: readonly EditorDocumentSnapshot[]
      readonly replacements: number
    }
  | { readonly status: "rejected"; readonly reason: string }

const spanSchema = z.object({
  start: z.number().int().nonnegative(),
  length: z.number().int().positive(),
})
const infoSchema = z.discriminatedUnion("canRename", [
  z.object({ canRename: z.literal(false), localizedErrorMessage: z.string() }),
  z.object({ canRename: z.literal(true), triggerSpan: spanSchema }),
])
const locationsSchema = z.array(
  z.object({
    fileName: z.string(),
    textSpan: spanSchema,
    prefixText: z.string().optional(),
    suffixText: z.string().optional(),
  })
)

/** Pure plan over captured open buffers. No disk writes, search caps or text fallback. */
export async function planSymbolRename(input: {
  readonly worker: SymbolRenameWorker
  readonly documents: readonly RenameDocument[]
  readonly currentUri: string
  readonly offset: number
  readonly newName: string
}): Promise<SymbolRenamePlan> {
  const reject = (reason: string): SymbolRenamePlan => ({
    status: "rejected",
    reason,
  })
  if (!isRenameableIdentifier(input.newName))
    return reject("Use a valid TypeScript/JavaScript binding name.")
  const sources = new Map(
    input.documents.map((document) => [document.uri, document.snapshot])
  )
  const current = sources.get(input.currentUri)
  if (
    sources.size !== input.documents.length ||
    !current ||
    !Number.isInteger(input.offset) ||
    input.offset < 0 ||
    input.offset > current.content.length
  ) {
    return reject(
      "The selected document is no longer available. Reopen Rename."
    )
  }
  const info = infoSchema.parse(
    await input.worker.getRenameInfo(input.currentUri, input.offset, {
      allowRenameOfImportPath: false,
    })
  )
  if (!info.canRename) return reject(info.localizedErrorMessage)
  const locations = locationsSchema.parse(
    (await input.worker.findRenameLocations(
      input.currentUri,
      input.offset,
      false,
      false,
      true
    )) ?? []
  )
  if (!locations.length)
    return reject("No semantic references found in the open files.")
  const byFile = new Map<string, typeof locations>()
  for (const location of locations) {
    if (!sources.has(location.fileName))
      return reject(
        "The language service found a reference outside the open files. Open that file before renaming: " +
          location.fileName
      )
    const entries = byFile.get(location.fileName) ?? []
    entries.push(location)
    byFile.set(location.fileName, entries)
  }
  const changes: EditorDocumentChange[] = []
  for (const [uri, entries] of byFile) {
    const expected = sources.get(uri)!
    let content = expected.content
    let previousStart = content.length
    for (const entry of entries.sort(
      (a, b) => b.textSpan.start - a.textSpan.start
    )) {
      const { start, length } = entry.textSpan
      if (start + length > previousStart)
        return reject(
          "The language service returned overlapping or out-of-range edits. Nothing was changed."
        )
      content =
        content.slice(0, start) +
        (entry.prefixText ?? "") +
        input.newName +
        (entry.suffixText ?? "") +
        content.slice(start + length)
      previousStart = start
    }
    changes.push({ expected, content })
  }
  return {
    status: "ready",
    changes,
    guards: input.documents.map((document) => document.snapshot),
    replacements: locations.length,
  }
}
