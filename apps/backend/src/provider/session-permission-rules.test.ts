import { afterEach, describe, expect, it, expectTypeOf } from "vitest"
import type { SessionPermissionRule } from "./session-permission-rules"
import {
  clearSessionRules,
  evaluateSessionRules,
  listSessionRules,
  recordSessionPermissionUpdates,
} from "./session-permission-rules"

const thread = "session-rule-test"
const rule = { toolName: "Bash", ruleContent: "npm test" }
afterEach(() => clearSessionRules(thread))
const evaluate = (command = "npm test") =>
  evaluateSessionRules(thread, "Bash", { command })
const update = (
  type: "addRules" | "replaceRules" | "removeRules",
  rules = [rule],
  behavior: SessionPermissionRule["behavior"] = "allow"
) => ({ type, rules, behavior, destination: "session" })

describe("session rule transitions", () => {
  it("revokes an allowed command", () => {
    recordSessionPermissionUpdates(thread, [
      update("addRules"),
      update("removeRules"),
    ])
    expect(evaluate()).toBeNull()
  })
  it("replaces the allow bucket while retaining denies", () => {
    recordSessionPermissionUpdates(thread, [
      update("addRules"),
      update(
        "addRules",
        [{ toolName: "Bash", ruleContent: "npm publish" }],
        "deny"
      ),
      update("replaceRules", [{ toolName: "Bash", ruleContent: "npm build" }]),
    ])
    expect(evaluate()).toBeNull()
    expect(evaluate("npm build")).toBe("allow")
    expect(evaluate("npm publish")).toBe("deny")
  })
  it("clears a behavior with an empty replacement", () => {
    recordSessionPermissionUpdates(thread, [
      update("addRules"),
      update("replaceRules", []),
    ])
    expect(evaluate()).toBeNull()
    expect(listSessionRules(thread)).toEqual([])
  })
  it("honors ask over allow and deny over ask", () => {
    recordSessionPermissionUpdates(thread, [
      update("addRules"),
      update("addRules", [rule], "ask"),
    ])
    expect(evaluate()).toBe("ask")
    recordSessionPermissionUpdates(thread, [update("addRules", [rule], "deny")])
    expect(evaluate()).toBe("deny")
  })
  it("reports invalid and provider-native updates without pretending to apply them", () => {
    expect(
      recordSessionPermissionUpdates(thread, [
        { type: "unknown" },
        { type: "setMode", mode: "plan", destination: "session" },
      ])
    ).toEqual({ applied: 0, invalid: 1, providerNative: 1 })
  })
  it("returns detached readonly views of the rules", () => {
    recordSessionPermissionUpdates(thread, [update("addRules")])
    const listed = listSessionRules(thread)
    expectTypeOf(listed).toEqualTypeOf<ReadonlyArray<SessionPermissionRule>>()
    // Simulates a JavaScript consumer; it cannot mutate policy through a query.
    Object.assign(listed[0], { ruleContent: "npm publish" })
    expect(evaluate()).toBe("allow")
    expect(evaluate("npm publish")).toBeNull()
  })
})
