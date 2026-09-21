import { useEffect } from "react"
import { maybeNotifyResponseComplete } from "@/lib/native-notifications"

export function useNativeNotifications() {
  useEffect(() => {
    const onResponseComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail
      maybeNotifyResponseComplete({ threadId: detail?.threadId })
    }

    window.addEventListener("betterc0de:response-complete", onResponseComplete)
    return () => {
      window.removeEventListener(
        "betterc0de:response-complete",
        onResponseComplete
      )
    }
  }, [])
}
