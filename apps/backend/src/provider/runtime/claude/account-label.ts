export interface ClaudeAccountLabel {
  readonly type: string
  readonly label: string
}

const PLAN_NAMES: Readonly<Record<string, string>> = {
  max: "Max", maxplan: "Max", max5: "Max 5x", max20: "Max 20x",
  enterprise: "Enterprise", team: "Team", pro: "Pro", free: "Free",
}
const SUBSCRIPTION_NAMES: Readonly<Record<string, string>> = {
  max: "Max", max5x: "Max 5x", max20x: "Max 20x",
  enterprise: "Enterprise", team: "Team", pro: "Pro", free: "Free",
}
const KEY_AUTH_METHODS = new Set(["apikey", "anthropicapikey", "anthropicauthtoken"])

function accountIdentifier(text: string): string {
  return text.replace(/[\s_-]/g, "").toLowerCase()
}

function subscriptionName(raw: string): string {
  const identifier = accountIdentifier(raw)
  const subscription = /^claude(.+)subscription$/.exec(identifier)
  const names = subscription ? SUBSCRIPTION_NAMES : PLAN_NAMES
  const key = subscription?.[1] ?? identifier
  const known = Object.hasOwn(names, key) ? names[key] : undefined
  if (known) return known
  return (raw.match(/[^\s_-]+/g) ?? [])
    .map(word => word.charAt(0).toUpperCase() + word.substring(1).toLowerCase())
    .join(" ")
}

/** Account presentation is separate from SDK transport and never decides authentication. */
export function describeClaudeAccount(input: {
  readonly subscriptionType: string | undefined
  readonly authMethod: string | undefined
}): ClaudeAccountLabel | undefined {
  if (KEY_AUTH_METHODS.has(accountIdentifier(input.authMethod ?? ""))) {
    return { type: "apiKey", label: "Claude API Key" }
  }
  if (!input.subscriptionType) return undefined
  const name = subscriptionName(input.subscriptionType)
  const identifier = accountIdentifier(name)
  const words = [
    ...(identifier.startsWith("claude") ? [] : ["Claude"]),
    name,
    ...(identifier.endsWith("subscription") ? [] : ["Subscription"]),
  ]
  return { type: input.subscriptionType, label: words.join(" ") }
}
