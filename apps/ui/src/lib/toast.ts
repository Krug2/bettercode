import { toast as sonnerToast } from "sonner"

import { useSettingsStore } from "@/lib/settings-store"

export interface ToastOptions {
  description?: string
  /** Stable ids make repeated toasts replace instead of stack. */
  id?: string | number
  duration?: number
}

export interface ToastActionOptions extends ToastOptions {
  action: {
    label: string
    onClick: () => void
  }
}

/**
 * Typed helper over sonner. Generic variants are ungated (explicit call sites
 * decide); only the error bridge and the attention watcher consult settings.
 */
export const toast = {
  success(message: string, opts?: ToastOptions) {
    return sonnerToast.success(message, opts)
  },
  error(message: string, opts?: ToastOptions) {
    return sonnerToast.error(message, opts)
  },
  info(message: string, opts?: ToastOptions) {
    return sonnerToast.info(message, opts)
  },
  warning(message: string, opts?: ToastOptions) {
    return sonnerToast.warning(message, opts)
  },
  action(message: string, opts: ToastActionOptions) {
    return sonnerToast(message, opts)
  },
  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id)
  },
}

type ToastBus = (message: string, source: string) => void

/**
 * Wire `handleError`'s toast bus (globalThis.__BETTERC0DE_TOAST__) to sonner.
 * Keeps the exact `(message, source)` signature asserted in errors.test.ts.
 * Returns an unregister function so a mounted Toaster owns the bus lifetime.
 */
export function registerErrorToastBridge(): () => void {
  const scope = globalThis as { __BETTERC0DE_TOAST__?: ToastBus }
  const bridge: ToastBus = (message, source) => {
    const settings = useSettingsStore.getState()
    if (!settings.toastEnabled || !settings.toastErrors) return
    // Stable id: identical repeated errors replace their toast instead of
    // stacking (anti-spam during streaming/reconnect loops).
    sonnerToast.error(message, {
      description: source,
      id: `err:${source}:${message}`,
    })
  }
  scope.__BETTERC0DE_TOAST__ = bridge
  return () => {
    if (scope.__BETTERC0DE_TOAST__ === bridge) {
      delete scope.__BETTERC0DE_TOAST__
    }
  }
}
