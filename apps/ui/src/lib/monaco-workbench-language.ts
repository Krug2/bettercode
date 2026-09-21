import type * as Monaco from "monaco-editor"

type TypeScriptService = typeof Monaco.languages.typescript
const scopes = new WeakMap<
  TypeScriptService,
  { users: number; restore: () => void }
>()

/** Monaco shares language defaults across editors; restore them after the last code pane closes. */
export function enableWorkbenchJsx(service: TypeScriptService): () => void {
  let scope = scopes.get(service)
  if (!scope) {
    const defaults = [service.typescriptDefaults, service.javascriptDefaults]
    const previous = defaults.map((item) => item.getCompilerOptions())
    defaults.forEach((item, index) =>
      item.setCompilerOptions({
        ...previous[index],
        // Open JS buffers participate in TS rename, including relative imports.
        allowJs: true,
        moduleResolution: previous[index].moduleResolution ?? service.ModuleResolutionKind.NodeJs,
        // A standalone TSX model needs JSX parsing even without a project graph.
        // Preserve avoids inventing a React runtime dependency for other JSX frameworks.
        jsx: service.JsxEmit.Preserve,
      })
    )
    scope = {
      users: 0,
      restore: () =>
        defaults.forEach((item, index) =>
          item.setCompilerOptions(previous[index])
        ),
    }
    scopes.set(service, scope)
  }
  scope.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--scope.users === 0) {
      scope.restore()
      scopes.delete(service)
    }
  }
}
