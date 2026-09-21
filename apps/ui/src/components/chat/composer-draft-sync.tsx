import { useEffect } from "react"
import { usePromptInputController } from "@/components/ai-elements/prompt-input"
import { useChatStore } from "@/lib/chat-store"
import { RESTORE_COMPOSER_DRAFT_EVENT, type RestoreComposerDraftEventDetail } from "@/lib/composer-draft-events"

/** ChatComposer keys its controller by thread and initializes it from that draft. */
export function ComposerDraftSync({ threadId, isActive }: { threadId: string | null; isActive: boolean }) {
  const { textInput } = usePromptInputController()
  const { value, setInput } = textInput
  useEffect(() => {
    if (threadId) useChatStore.getState().setDraft(threadId, value)
  }, [threadId, value])

  useEffect(() => {
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent<RestoreComposerDraftEventDetail>).detail
      if (!detail || typeof detail.text !== "string") return
      if (detail.threadId !== undefined ? detail.threadId !== threadId : !isActive) return
      setInput(detail.text)
    }
    window.addEventListener(RESTORE_COMPOSER_DRAFT_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_COMPOSER_DRAFT_EVENT, onRestore)
  }, [threadId, isActive, setInput])
  return null
}
