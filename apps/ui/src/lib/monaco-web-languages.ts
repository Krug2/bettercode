import type * as Monaco from "monaco-editor"

const configured = new WeakSet<typeof Monaco>()

export function registerWebLanguageAliases(monaco: typeof Monaco) {
  if (configured.has(monaco)) return
  configured.add(monaco)
  const jsonTypes = ["application/ld+json", "application/manifest+json", "importmap", "speculationrules"]
  const registered = new Set(monaco.languages.getLanguages()
    .filter((language) => language.id === "json")
    .flatMap((language) => language.mimetypes ?? []))
  const missing = jsonTypes.filter((type) => !registered.has(type))
  if (missing.length) {
    // HTML delegates <script type="..."> contents by MIME type. JSON-LD and
    // import maps must use JSON tokens instead of becoming uncolored text.
    monaco.languages.register({ id: "json", mimetypes: missing })
  }
  monaco.languages.onLanguageEncountered("json", () => {
    // Embedded languages request only basic features, but Monaco registers its
    // JSON tokenizer on the first JSON model. Trigger that public initialization
    // path and release the empty model immediately; no file is opened or read.
    monaco.editor.createModel("", "json").dispose()
  })
}
