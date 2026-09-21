import { useEffect, useRef } from "react"
import { usePromptInputController } from "@/components/ai-elements/prompt-input"
import { usePreferencesStore } from "@/lib/preferences-store"
import { promptHistoryInputForIndex } from "@/lib/prompt-history"

export function ComposerPromptHistorySync({ threadId }: { threadId: string | null }) {
  const controller = usePromptInputController()
  const historyIndexRef = useRef(0)
  const draftBeforeHistoryRef = useRef("")
  const applyingHistoryRef = useRef(false)
  const valueRef = useRef(controller.textInput.value)
  const setInputRef = useRef(controller.textInput.setInput)
  const setInput = controller.textInput.setInput
  const value = controller.textInput.value

  useEffect(() => {
    valueRef.current = value
    setInputRef.current = setInput
  }, [value, setInput])

  useEffect(() => {
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false
      return
    }
    historyIndexRef.current = 0
    draftBeforeHistoryRef.current = ""
  }, [value])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) return
      if (target.name !== "message") return
      const scope = target.closest<HTMLElement>("[data-composer-thread]")
      if (scope?.dataset.composerThread !== (threadId ?? "")) return
      if (scope.querySelector("[data-slash-command-menu], [data-file-mention-menu]")) return
      if (target.selectionStart !== target.selectionEnd) return

      const direction = event.key === "ArrowUp" ? -1 : 1
      if (direction === -1 && target.selectionStart !== 0) return
      if (direction === 1 && target.selectionStart !== target.value.length)
        return

      const entries = usePreferencesStore.getState().promptHistoryEntries
      if (entries.length === 0) return
      const currentIndex = historyIndexRef.current
      const nextIndex = Math.max(
        -entries.length,
        Math.min(0, currentIndex + direction)
      )
      if (nextIndex === currentIndex) return

      if (currentIndex === 0) {
        draftBeforeHistoryRef.current = valueRef.current
      } else {
        const currentHistoryInput = promptHistoryInputForIndex(
          entries,
          currentIndex,
          draftBeforeHistoryRef.current
        )
        if (
          currentHistoryInput !== null &&
          currentHistoryInput !== valueRef.current
        ) {
          historyIndexRef.current = 0
          draftBeforeHistoryRef.current = ""
          return
        }
      }

      const nextInput = promptHistoryInputForIndex(
        entries,
        nextIndex,
        draftBeforeHistoryRef.current
      )
      if (nextInput === null) return
      event.preventDefault()
      historyIndexRef.current = nextIndex
      applyingHistoryRef.current = true
      setInputRef.current(nextInput)
      window.requestAnimationFrame(() => {
        const cursor = direction === -1 ? 0 : nextInput.length
        target.setSelectionRange(cursor, cursor)
      })
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [threadId])

  return null
}
