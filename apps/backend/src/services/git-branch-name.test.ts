import { describe, expect, it } from "vitest"
import { branchFragment, featureBranchName } from "./git-branch-name"

describe("generated branch names", () => {
  it.each([
    ['  "Fix Login Timeout!!!"  ', "fix-login-timeout"],
    ["///Feature///Add___Auth---Flow///", "feature/add___auth-flow"],
    ["._ /__--`   ", "update"],
    ["Fix: unsafe@{ref} and ..dots.lock", "fix-unsafe-ref-and-dots-lock"],
    ["a".repeat(63) + "/next", "a".repeat(63)],
    ["a".repeat(100), "a".repeat(64)],
  ])("normalizes %j to a bounded fragment", (input, expected) => {
    expect(branchFragment(input)).toBe(expected)
  })

  it("adds the feature namespace once", () => {
    expect(featureBranchName("feature/add-login")).toBe("feature/add-login")
    expect(featureBranchName("auth/add-login")).toBe("feature/auth/add-login")
    expect(featureBranchName("")).toBe("feature/update")
  })
})
