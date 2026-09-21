import { useState } from "react"
import { useConsoleCapture, type ConsoleLog } from "@/hooks/use-console-capture"

/**
 * Combines the console log state + the capture side-effect that feeds it.
 *
 * Separates concerns from {@link useConsoleCapture} which only owns the
 * side effect — this wrapper owns the state itself, so App.tsx gets a
 * single drop-in with both the reactive values and the log stream
 * plumbing.
 */
export function useConsoleLogState() {
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([])
  const [consoleTab, setConsoleTab] = useState<"console" | "report">(
    "console"
  )
  useConsoleCapture(setConsoleLogs)
  return {
    consoleLogs,
    setConsoleLogs,
    consoleTab,
    setConsoleTab,
  }
}
