import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export interface PromptOptions {
  title: string
  description?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

/** Resolves to the entered text, or null when the user cancels. */
type PromptFn = (options: PromptOptions) => Promise<string | null>

const PromptContext = React.createContext<PromptFn | undefined>(undefined)

interface PendingPrompt {
  options: PromptOptions
  resolve: (value: string | null) => void
}

/**
 * Promise-based imperative text prompt, shaped like {@link useConfirm}.
 *
 * Electron's renderer does not implement `window.prompt` — calling it throws
 * "prompt() is not supported" and takes the click handler down with it. Three
 * separate "Rename thread" buttons were built on it, so renaming a thread was
 * broken everywhere it was offered.
 *
 * Returns the raw string so call sites keep deciding what counts as empty,
 * exactly as they did with the native dialog.
 */
export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingPrompt | null>(null)
  const [value, setValue] = React.useState("")

  const prompt = React.useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      setValue(options.defaultValue ?? "")
      // Opened one tick later, on purpose. Every caller so far triggers this
      // from inside a Radix dropdown item. That menu closes in the same tick
      // and hands focus back to its trigger — which the dialog's dismiss layer
      // sees as an interaction outside itself and closes again immediately.
      // The rename menu item looked like it did nothing at all.
      setTimeout(() => {
        setPending((prev) => {
          // A second prompt while one is open settles the first as cancelled.
          prev?.resolve(null)
          return { options, resolve }
        })
      }, 0)
    })
  }, [])

  const settle = React.useCallback((result: string | null) => {
    setPending((prev) => {
      prev?.resolve(result)
      return null
    })
  }, [])

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              settle(value)
            }}
          >
            <DialogHeader>
              <DialogTitle>{pending?.options.title}</DialogTitle>
              {pending?.options.description ? (
                <DialogDescription className="whitespace-pre-line">
                  {pending.options.description}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            <Input
              // Enter submits through the form; Escape closes via the Dialog.
              autoFocus
              value={value}
              placeholder={pending?.options.placeholder}
              onChange={(event) => setValue(event.target.value)}
              className="my-4"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => settle(null)}
              >
                {pending?.options.cancelLabel ?? "Cancel"}
              </Button>
              <Button type="submit">
                {pending?.options.confirmLabel ?? "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  )
}

export function usePrompt(): PromptFn {
  const context = React.useContext(PromptContext)
  if (context === undefined) {
    throw new Error("usePrompt must be used within a PromptProvider")
  }
  return context
}
