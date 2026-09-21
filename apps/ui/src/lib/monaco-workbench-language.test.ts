import { describe, expect, it, vi } from "vitest"
import { enableWorkbenchJsx } from "./monaco-workbench-language"

describe("editor JSX language scope", () => {
  it("keeps JSX enabled across split panes and restores defaults before returning to the agent modal", () => {
    const makeDefaults = () => {
      let options = { strict: true, jsx: 0 }
      return {
        getCompilerOptions: () => options,
        setCompilerOptions: vi.fn((value) => {
          options = value
        }),
      }
    }
    const service = {
      JsxEmit: { Preserve: 1 },
      ModuleResolutionKind: { NodeJs: 2 },
      typescriptDefaults: makeDefaults(),
      javascriptDefaults: makeDefaults(),
    }
    const first = enableWorkbenchJsx(
      service as unknown as Parameters<typeof enableWorkbenchJsx>[0]
    )
    const second = enableWorkbenchJsx(
      service as unknown as Parameters<typeof enableWorkbenchJsx>[0]
    )
    expect(service.typescriptDefaults.getCompilerOptions()).toEqual({
      strict: true,
      jsx: 1,
      allowJs: true,
      moduleResolution: 2,
    })
    first()
    first()
    expect(service.javascriptDefaults.getCompilerOptions().jsx).toBe(1)
    second()
    expect(service.typescriptDefaults.getCompilerOptions()).toEqual({
      strict: true,
      jsx: 0,
    })
    expect(service.javascriptDefaults.getCompilerOptions()).toEqual({
      strict: true,
      jsx: 0,
    })
  })
})
