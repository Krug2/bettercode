import { describe, expect, it } from "vitest"
import { isHttpApprovalProviderKind } from "./use-tool-approval"

describe("isHttpApprovalProviderKind", () => {
  it("routes Cursor and BetterC0de provider approvals through the backend API", () => {
    expect(isHttpApprovalProviderKind("cursor")).toBe(true)
    expect(isHttpApprovalProviderKind("BetterC0de")).toBe(true)
  })

  it("keeps unknown provider approvals on the legacy fallback path", () => {
    expect(isHttpApprovalProviderKind("legacy-plugin")).toBe(false)
  })
})
