import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import { registerWebLanguageAliases } from "@/lib/monaco-web-languages"

// Use local monaco-editor instead of CDN (Electron/offline support)
loader.config({ monaco })
registerWebLanguageAliases(monaco)

// Monaco's web-worker registration goes on a global `MonacoEnvironment`
// that the Worker bootstrap inside `monaco-editor/esm` reads at runtime.
// `Window` in the project types doesn't declare it, so we cast through
// an explicit shape rather than augmenting the global type for one call.
;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new Worker(
          new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
          { type: "module" }
        )
      case "json":
        return new Worker(
          new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
          { type: "module" }
        )
      case "css":
      case "scss":
      case "less":
        return new Worker(
          new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
          { type: "module" }
        )
      case "html":
      case "handlebars":
      case "razor":
        return new Worker(
          new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
          { type: "module" }
        )
      default:
        return new Worker(
          new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
          { type: "module" }
        )
    }
  },
} as monaco.Environment
