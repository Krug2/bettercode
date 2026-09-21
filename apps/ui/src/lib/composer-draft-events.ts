import { useChatStore } from "@/lib/chat-store"

export const RESTORE_COMPOSER_DRAFT_EVENT =
  "betterc0de:restore-composer-draft"

export interface RestoreComposerDraftEventDetail {
  threadId?: string | null
  text: string
}

export function dispatchComposerDraftRestoreAfterSubmit(
  detail: RestoreComposerDraftEventDetail
): void {
  if (typeof window === "undefined") return
  window.setTimeout(() => {
    if (detail.threadId) useChatStore.getState().setDraft(detail.threadId, detail.text)
    window.dispatchEvent(
      new CustomEvent<RestoreComposerDraftEventDetail>(
        RESTORE_COMPOSER_DRAFT_EVENT,
        { detail }
      )
    )
  }, 0)
}
