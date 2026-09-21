import { describe, expect, it } from "vitest"
import { describeClaudeAccount } from "./account-label"

describe("Claude account labels", () => {
  it.each([
    ["claudeMaxSubscription", "Max"], ["claudeMax5xSubscription", "Max 5x"],
    ["claudeMax20xSubscription", "Max 20x"], ["claudeEnterpriseSubscription", "Enterprise"],
    ["claudeTeamSubscription", "Team"], ["claudeProSubscription", "Pro"],
    ["claudeFreeSubscription", "Free"], ["maxplan", "Max"], ["max5", "Max 5x"],
    ["max20", "Max 20x"], ["team", "Team"], ["pro", "Pro"], ["free", "Free"],
  ])("formats %s while retaining the reported account type", (subscriptionType, name) => {
    expect(describeClaudeAccount({ subscriptionType, authMethod: undefined })).toEqual({
      type: subscriptionType, label: `Claude ${name} Subscription`,
    })
  })

  it.each(["api_key", "Anthropic API Key", "anthropic-auth-token"])("prioritizes %s over a subscription", authMethod => {
    expect(describeClaudeAccount({ authMethod, subscriptionType: "pro" })).toEqual({
      type: "apiKey", label: "Claude API Key",
    })
  })

  it.each([
    ["future_team", "Claude Future Team Subscription"],
    ["Claude Future Subscription", "Claude Future Subscription"],
    ["Claude Future", "Claude Future Subscription"],
    ["Future Subscription", "Claude Future Subscription"],
    ["constructor", "Claude Constructor Subscription"],
    ["__proto__", "Claude Proto Subscription"],
  ])("uses a readable fallback for %s", (subscriptionType, label) => {
    expect(describeClaudeAccount({ subscriptionType, authMethod: "oauth" })).toEqual({ type: subscriptionType, label })
  })

  it("does not invent account data when authentication is unknown", () => {
    expect(describeClaudeAccount({ authMethod: "oauth", subscriptionType: undefined })).toBeUndefined()
  })
})
