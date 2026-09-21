import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | undefined>(undefined)

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

/**
 * Promise-based imperative confirm over AlertDialog. Replacement for
 * `window.confirm` at async call sites; the existing prop-drilled
 * `ConfirmActionDialog` stays for its current callers.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending((prev) => {
        // A second confirm while one is open settles the first as cancelled.
        prev?.resolve(false)
        return { options, resolve }
      })
    })
  }, [])

  const settle = React.useCallback((value: boolean) => {
    setPending((prev) => {
      prev?.resolve(value)
      return null
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.options.title}</AlertDialogTitle>
            {pending?.options.description ? (
              <AlertDialogDescription className="whitespace-pre-line">
                {pending.options.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.options.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.options.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {pending?.options.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const context = React.useContext(ConfirmContext)
  if (context === undefined) {
    throw new Error("useConfirm must be used within a ConfirmProvider")
  }
  return context
}
