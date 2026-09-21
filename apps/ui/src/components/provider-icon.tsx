import { TerminalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { UiProvider } from "@/lib/provider-types"

/**
 * Renders the provider's logo, or a generic terminal icon as fallback.
 *
 * OpenAI and Google logos are slightly larger to match their on-brand
 * weight (their marks look thin next to Anthropic's at the same px size).
 * `invertDark` flips monochrome glyphs for dark themes — only set on
 * providers whose source logo is black-on-transparent.
 */
export function ProviderIcon({
  provider,
  className,
}: {
  provider: UiProvider
  className?: string
}) {
  if (!provider?.logo)
    return <TerminalIcon className={cn("size-4", className)} />
  const isLarger = provider.id === "openai" || provider.id === "google"
  return (
    <img
      src={provider.logo}
      alt={provider.name}
      className={cn(
        isLarger ? "size-[18px]" : "size-4",
        "invertDark" in provider && provider.invertDark && "dark:invert",
        className
      )}
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = "none"
      }}
    />
  )
}
