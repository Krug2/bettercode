/** Shared outer width. Transcript and composer each own the same 16px gutter. */
export function chatContentWidth(minimal: boolean): string {
  return minimal ? "max-w-[900px]" : "max-w-[var(--chat-max-width)]"
}
