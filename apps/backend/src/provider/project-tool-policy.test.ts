import { describe, expect, it } from "vitest"
import {
  evaluateBetterC0deProjectToolPermission,
  filterToolsForBetterC0deProjectPolicy,
  projectPermissionForTool,
  projectPermissionPattern,
} from "./project-tool-policy"

describe("BetterC0de project tool policy", () => {
  it("filters Claude tools disabled by BetterC0de tools config", () => {
    expect(
      filterToolsForBetterC0deProjectPolicy(
        ["Read", "Bash", "Edit", "WebFetch"],
        {
          toolFlags: [
            { tool: "bash", enabled: false },
            { tool: "webfetch", enabled: false },
          ],
        }
      )
    ).toEqual(["Read", "Edit"])
  })

  it("does not treat discovered custom tool modules as legacy tool flags", () => {
    expect(
      filterToolsForBetterC0deProjectPolicy(["RepoOverview"], {
        toolFlags: [
          { tool: "repo_overview", enabled: false, kind: "custom" },
        ],
      })
    ).toEqual(["RepoOverview"])
  })

  it("filters tools denied by wildcard BetterC0de permission rules", () => {
    expect(
      filterToolsForBetterC0deProjectPolicy(["Read", "Write", "Agent"], {
        permissionRules: [
          { permission: "edit", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
        ],
      })
    ).toEqual(["Read"])
  })

  it("maps Claude tool names to BetterC0de permission names", () => {
    expect(projectPermissionForTool("Bash")).toBe("bash")
    expect(projectPermissionForTool("patch")).toBe("edit")
    expect(projectPermissionForTool("NotebookEdit")).toBe("edit")
    expect(projectPermissionForTool("fetch")).toBe("webfetch")
    expect(projectPermissionForTool("search")).toBe("websearch")
    expect(projectPermissionForTool("AskUserQuestion")).toBe("question")
    expect(projectPermissionForTool("ExitPlanMode")).toBe("plan_exit")
    expect(projectPermissionForTool("repo_clone")).toBe("repo_clone")
    expect(projectPermissionForTool("RepoOverview")).toBe("repo_overview")
    expect(projectPermissionForTool("external-directory")).toBe(
      "external_directory"
    )
  })

  it("extracts command and path patterns from tool inputs", () => {
    expect(projectPermissionPattern("Bash", { command: "npm test" })).toBe(
      "npm test"
    )
    expect(projectPermissionPattern("Edit", { file_path: "src/app.ts" })).toBe(
      "src/app.ts"
    )
    expect(
      projectPermissionPattern("repo_clone", { repository: "owner/repo" })
    ).toBe("owner/repo")
    expect(
      projectPermissionPattern("repo_overview", { path: "../other" })
    ).toBe("../other")
    expect(
      projectPermissionPattern("external_directory", {
        parentDir: "/tmp/external",
      })
    ).toBe("/tmp/external")
  })

  it("evaluates BetterC0de permission rules against the actual tool call", () => {
    expect(
      evaluateBetterC0deProjectToolPermission(
        [
          { permission: "bash", pattern: "npm *", action: "ask" },
          { permission: "bash", pattern: "npm test *", action: "allow" },
          { permission: "bash", pattern: "rm *", action: "deny" },
        ],
        { toolName: "Bash", toolInput: { command: "npm test -- --runInBand" } }
      )
    ).toMatchObject({
      permission: "bash",
      pattern: "npm test -- --runInBand",
      action: "allow",
    })

    expect(
      evaluateBetterC0deProjectToolPermission(
        [{ permission: "edit", pattern: "src/generated/*", action: "deny" }],
        { toolName: "Write", toolInput: { file_path: "src/generated/out.ts" } }
      )
    ).toMatchObject({ action: "deny" })

    expect(
      evaluateBetterC0deProjectToolPermission(
        [{ permission: "repo_clone", pattern: "github.com/acme/*", action: "ask" }],
        {
          toolName: "repo_clone",
          toolInput: { repository: "github.com/acme/app" },
        }
      )
    ).toMatchObject({
      permission: "repo_clone",
      pattern: "github.com/acme/app",
      action: "ask",
    })
  })
})
