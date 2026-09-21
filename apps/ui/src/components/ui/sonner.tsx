import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { registerErrorToastBridge } from "@/lib/toast"

/**
 * App-wide toast host. Uses the app ThemeProvider (not next-themes) and
 * styles exclusively through theme tokens so appearance templates and
 * light/dark switches restyle toasts automatically.
 */
function Toaster(props: ToasterProps) {
  const { theme } = useTheme()

  // The error-toast bridge (globalThis.__BETTERC0DE_TOAST__) is only live
  // while a Toaster is mounted; StrictMode double-invoke is safe because the
  // effect cleanup unregisters.
  React.useEffect(() => registerErrorToastBridge(), [])

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast: "group",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
