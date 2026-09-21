import { describe, expect, it } from "vitest"
import {
  evaluateProjectPermissionRules,
  wildcardMatch,
} from "./project-permission-rules"

describe("BetterC0de project permission rules", () => {
  it("matches BetterC0de wildcards including optional trailing command arguments", () => {
    expect(wildcardMatch("npm test", "npm test *")).toBe(true)
    expect(wildcardMatch("npm test -- --runInBand", "npm test *")).toBe(true)
    expect(wildcardMatch("src\\index.ts", "src/*.ts")).toBe(true)
  })

  it("uses BetterC0de findLast precedence for matching rules", () => {
    const rule = evaluateProjectPermissionRules(
      [
        { permission: "bash", pattern: "npm *", action: "ask" },
        { permission: "bash", pattern: "npm test *", action: "allow" },
        { permission: "bash", pattern: "npm test --danger", action: "deny" },
      ],
      { permission: "bash", pattern: "npm test --danger" }
    )

    expect(rule).toEqual({
      permission: "bash",
      pattern: "npm test --danger",
      action: "deny",
    })
  })

  it("returns null when no project rule matches so app-level policy stays authoritative", () => {
    expect(
      evaluateProjectPermissionRules(
        [{ permission: "edit", pattern: "*", action: "deny" }],
        { permission: "bash", pattern: "npm test" }
      )
    ).toBeNull()
  })
})
