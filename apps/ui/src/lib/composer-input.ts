/** Resolve a composer once, before an async action can outlive its pane's focus. */
export function findComposerTextarea(threadId?: string | null): HTMLTextAreaElement | null {
  if (typeof document === "undefined") return null
  const scopes = [...document.querySelectorAll<HTMLElement>("[data-composer-thread]")]
  const scope = threadId === undefined
    ? scopes.find(node => node.dataset.composerActive === "true")
    : scopes.find(node => node.dataset.composerThread === (threadId ?? ""))
  return scope?.querySelector<HTMLTextAreaElement>('textarea[name="message"]') ?? null
}

export function setComposerInput(input: HTMLTextAreaElement | null, text: string, focus = false): void {
  if (!input?.isConnected) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(input, text)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  if (focus) {
    input.setSelectionRange(text.length, text.length)
    input.focus()
  }
}
