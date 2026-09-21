import { memo } from "react"
import { CircleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  getProviderStatusBannerView,
  type ProviderStatusBannerInput,
} from "@/lib/provider-status-banner"
import { cn } from "@/lib/utils"

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  provider,
}: {
  provider: ProviderStatusBannerInput | null | undefined
}) {
  const view = getProviderStatusBannerView(provider)
  if (!view) return null

  const isError = view.tone === "error"
  return (
    <div className="mx-auto w-full max-w-[var(--chat-max-width)] px-4 pt-3">
      <Alert
        variant={isError ? "destructive" : "default"}
        className={cn(
          "rounded-xl",
          !isError &&
            "border-amber-500/25 bg-amber-500/8 text-amber-600 dark:text-amber-300 [&_[data-slot=alert-description]]:text-amber-700/80 dark:[&_[data-slot=alert-description]]:text-amber-200/80"
        )}
      >
        <CircleAlertIcon className="size-4" />
        <AlertTitle>{view.title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={view.message}>
          {view.message}
        </AlertDescription>
      </Alert>
    </div>
  )
})
