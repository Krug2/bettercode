import { copyText } from "@/lib/clipboard"
import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { logToErrorStore, useErrorLogStore } from "@/lib/error-log-store"

interface ErrorBoundaryProps {
  children: ReactNode
  /** Name shown in the fallback UI — identifies which panel crashed. */
  label?: string
  /** Optional custom fallback renderer. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  resetKey: number
  /**
   * Diagnostics text shown inline when the clipboard refuses. The old
   * fallback was `window.prompt`, which Electron does not implement — so the
   * last resort threw inside the catch that was already handling a failure.
   */
  manualCopyText: string | null
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    resetKey: 0,
    manualCopyText: null,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logToErrorStore({
      level: "boundary",
      message: error.message || String(error),
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      source: this.props.label,
    })
  }

  reset = () => {
    this.setState((s) => ({
      error: null,
      resetKey: s.resetKey + 1,
      manualCopyText: null,
    }))
  }

  copyDiagnostics = async () => {
    const err = this.state.error
    if (!err) return
    const block = [
      `[boundary:${this.props.label ?? "unknown"}] ${err.message}`,
      err.stack ?? "(no stack)",
      "",
      "--- recent error log ---",
      useErrorLogStore.getState().copyAll(),
    ].join("\n")
    const copied = await copyText(block)
    this.setState({ manualCopyText: copied ? null : block })
  }

  render() {
    const { error, resetKey } = this.state
    if (!error) {
      // Re-mount children on reset by keying off resetKey.
      return <div key={resetKey} className="contents">{this.props.children}</div>
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <div className="text-base font-medium text-foreground">
          {this.props.label ? `${this.props.label} crashed` : "Something crashed"}
        </div>
        <div className="max-w-[48ch] break-words text-xs opacity-75">
          {error.message || String(error)}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="default" onClick={this.reset}>
            Reload this panel
          </Button>
          <Button size="sm" variant="outline" onClick={this.copyDiagnostics}>
            Copy diagnostics
          </Button>
        </div>
        {this.state.manualCopyText !== null && (
          <div className="flex w-full max-w-[64ch] flex-col gap-1">
            <div className="text-xs">
              The clipboard was unavailable — select the text and copy it.
            </div>
            <textarea
              readOnly
              autoFocus
              // Selecting on focus means one keystroke is enough from here.
              onFocus={(event) => event.currentTarget.select()}
              value={this.state.manualCopyText}
              className="h-40 w-full resize-none rounded-md border border-border bg-muted/40 p-2 text-left font-mono text-[11px] leading-snug"
            />
          </div>
        )}
      </div>
    )
  }
}
