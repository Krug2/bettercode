import { useCallback, useEffect, useRef, useState } from "react"
import { useDeepgram } from "@/lib/use-deepgram"
import { useVoiceStore } from "@/lib/voice-store"
import { findComposerTextarea, setComposerInput } from "@/lib/composer-input"
import { publishDictationPreview, updateDictationDraft, type DictationDraft } from "@/lib/dictation-preview"

/** A recording owns one textarea; only its unedited provisional suffix is replaceable. */
export function useVoiceInput() {
  const [voiceModalOpen, setVoiceModalOpen] = useState(false)
  const voiceSetupComplete = useVoiceStore((s) => s.setupComplete)
  const deepgram = useDeepgram()
  const { start, stop, cancel } = deepgram
  const voiceTarget = useRef<HTMLTextAreaElement | null>(null)
  const draft = useRef<DictationDraft | null>(null)
  const writingTranscript = useRef(false)
  const removeTargetListeners = useRef<(() => void) | null>(null)
  const pendingVoiceThread = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    void useVoiceStore.getState().init().catch(() => {})
  }, [])

  const releaseTarget = useCallback((discardInterim: boolean) => {
    removeTargetListeners.current?.()
    removeTargetListeners.current = null
    const textarea = voiceTarget.current
    const previous = draft.current
    voiceTarget.current = null
    draft.current = null
    if (!textarea?.isConnected) return
    if (discardInterim && previous?.interimStart != null && textarea.value === previous.value) {
      setComposerInput(textarea, previous.value.slice(0, previous.interimStart))
    }
    publishDictationPreview(textarea, { value: textarea.value, interimStart: null })
  }, [])

  useEffect(() => () => releaseTarget(true), [releaseTarget])

  const startVoice = useCallback(() => {
    if (voiceTarget.current) return
    const textarea = findComposerTextarea(pendingVoiceThread.current)
    if (!textarea) return
    const ownerThread = textarea.closest<HTMLElement>("[data-composer-thread]")?.dataset.composerThread
    voiceTarget.current = textarea
    draft.current = null

    // Explicit editing or sending takes ownership away from dictation. Late
    // results must never overwrite edits or repopulate a submitted message.
    const takeOwnership = () => {
      if (writingTranscript.current) return
      releaseTarget(false)
      cancel()
    }
    const form = textarea.form
    textarea.addEventListener("input", takeOwnership)
    form?.addEventListener("submit", takeOwnership, true)
    removeTargetListeners.current = () => {
      textarea.removeEventListener("input", takeOwnership)
      form?.removeEventListener("submit", takeOwnership, true)
    }

    const writeTranscript = (text: string, final: boolean) => {
      if (voiceTarget.current !== textarea) return
      if (!textarea.isConnected ||
          textarea.closest<HTMLElement>("[data-composer-thread]")?.dataset.composerThread !== ownerThread) {
        releaseTarget(false)
        cancel()
        return
      }
      const next = updateDictationDraft(textarea.value, draft.current, text, final)
      draft.current = next
      writingTranscript.current = true
      try {
        setComposerInput(textarea, next.value)
        publishDictationPreview(textarea, next)
      } finally {
        writingTranscript.current = false
      }
    }

    void start({
      onInterim: (text) => writeTranscript(text, false),
      onFinal: (text) => writeTranscript(text, true),
      onEnd: () => releaseTarget(true),
    })
  }, [start, cancel, releaseTarget])

  const handleVoiceClick = useCallback((threadId?: string | null) => {
    if (voiceTarget.current) {
      stop()
      return
    }
    pendingVoiceThread.current = threadId
    if (!voiceSetupComplete) {
      setVoiceModalOpen(true)
      return
    }
    startVoice()
  }, [stop, voiceSetupComplete, startVoice])

  const handleVoiceContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    pendingVoiceThread.current = event.currentTarget.closest<HTMLElement>("[data-composer-thread]")?.dataset.composerThread
    setVoiceModalOpen(true)
  }, [])

  return {
    voiceModalOpen, setVoiceModalOpen, voiceSetupComplete, deepgram,
    startVoice, handleVoiceClick, handleVoiceContextMenu,
  }
}
