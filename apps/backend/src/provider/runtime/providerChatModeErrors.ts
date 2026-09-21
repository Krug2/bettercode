/**
 * Raised when a provider cannot guarantee the chat mode the user selected.
 *
 * Read-only intents (Ask, Plan, Security) must fail closed: running a
 * write-capable agent because the provider could not confirm a read-only mode
 * would be exactly the outcome the user chose the mode to avoid. But the
 * failure is the user's to act on — they can switch modes or providers — so
 * unlike an internal dispatch fault its message is carried through to the
 * client verbatim instead of being flattened into "Provider turn dispatch
 * failed."
 */
export class ProviderChatModeUnsupportedError extends Error {
  readonly providerLabel: string
  readonly chatMode: string

  constructor(input: {
    readonly providerLabel: string
    readonly chatMode: string
    readonly detail?: string
  }) {
    super(
      `${input.providerLabel} does not support ${input.chatMode} mode. ` +
        `Switch to Agent mode for this chat, or pick another provider.` +
        (input.detail ? ` (${input.detail})` : "")
    )
    this.name = "ProviderChatModeUnsupportedError"
    this.providerLabel = input.providerLabel
    this.chatMode = input.chatMode
  }
}

export function isProviderChatModeUnsupportedError(
  error: unknown
): error is ProviderChatModeUnsupportedError {
  return (
    error instanceof ProviderChatModeUnsupportedError ||
    (error instanceof Error &&
      error.name === "ProviderChatModeUnsupportedError")
  )
}
