import { beforeEach, describe, expect, it, vi } from "vitest"
import { getProjectRules } from "./project-rules"
import {
  listProjectInstructions,
  readFile,
} from "@/services/backend/workspaceApi"

vi.mock("@/services/backend/workspaceApi", () => ({
  readFile: vi.fn(),
  listProjectInstructions: vi.fn(),
}))

const readFileMock = vi.mocked(readFile)
const listProjectInstructionsMock = vi.mocked(listProjectInstructions)

describe("getProjectRules", () => {
  beforeEach(() => {
    readFileMock.mockReset()
    listProjectInstructionsMock.mockReset()
  })

  it("merges known project rule files with BetterC0de compatibility instruction files", async () => {
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith("AGENTS.md")) {
        return { path: filePath, content: "Use pnpm test." }
      }
      if (filePath.endsWith("CONTEXT.md")) {
        return { path: filePath, content: "Legacy BetterC0de compatibility context." }
      }
      throw new Error("not found")
    })
    listProjectInstructionsMock.mockResolvedValue([
      {
        sourcePath: "docs/ai.md",
        content: "Follow BetterC0de compatibility instructions.",
      },
    ])

    await expect(getProjectRules("/repo")).resolves.toContain("### AGENTS.md")
    const rules = await getProjectRules("/repo")
    expect(rules).toContain("Use pnpm test.")
    expect(rules).toContain("### CONTEXT.md")
    expect(rules).toContain("Legacy BetterC0de compatibility context.")
    expect(rules).toContain("### BetterC0de compatibility instructions: docs/ai.md")
    expect(rules).toContain("Follow BetterC0de compatibility instructions.")
  })

  it("returns null when no known rules or BetterC0de compatibility instructions are available", async () => {
    readFileMock.mockRejectedValue(new Error("not found"))
    listProjectInstructionsMock.mockResolvedValue([])

    await expect(getProjectRules("/repo")).resolves.toBeNull()
  })
})
