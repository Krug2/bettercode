import { describe, expect, it } from "vitest"
import { shouldExpandToolCallByDefault } from "@/components/chat/tool-call-item"

describe("shouldExpandToolCallByDefault", () => {
  it("honors the global tool-details default", () => {
    expect(
      shouldExpandToolCallByDefault({
        toolName: "Read",
        defaultOpen: true,
      })
    ).toBe(true)
  })

  it("expands shell-like tools only when shell parts are enabled", () => {
    expect(
      shouldExpandToolCallByDefault({
        toolName: "shell",
        shellToolPartsExpanded: true,
      })
    ).toBe(true)
    expect(
      shouldExpandToolCallByDefault({
        toolName: "bash",
        shellToolPartsExpanded: false,
      })
    ).toBe(false)
  })

  it("expands edit, write, and patch tools only when edit parts are enabled", () => {
    for (const toolName of ["Edit", "Write", "Patch"]) {
      expect(
        shouldExpandToolCallByDefault({
          toolName,
          editToolPartsExpanded: true,
        })
      ).toBe(true)
    }
    expect(
      shouldExpandToolCallByDefault({
        toolName: "Read",
        editToolPartsExpanded: true,
      })
    ).toBe(false)
  })
})
