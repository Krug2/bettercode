import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function ComposerSuggestionPanel({
  symbol,
  title,
  detail,
  toolbar,
  children,
  notice,
}: {
  symbol: string
  title: string
  detail?: string
  toolbar?: ReactNode
  children: ReactNode
  notice?: ReactNode
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-border/60 bg-sidebar text-foreground shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]">
      <div className="flex min-h-10 items-center gap-2 border-b border-border/50 px-3.5 py-2">
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-xs font-medium text-muted-foreground">{symbol}</span>
        <span className="text-xs font-medium">{title}</span>
        {detail && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{detail}</span>}
      </div>
      {toolbar}
      <div className="max-h-60 overflow-y-auto overscroll-contain p-1.5">{children}</div>
      {notice}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3.5 py-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><kbd className="font-sans">↑ ↓</kbd> Navigate</span>
        <span className="flex items-center gap-3">
          <span><kbd className="font-sans font-medium text-foreground/75">Tab ↵</kbd> Select</span>
          <span><kbd className="font-sans font-medium text-foreground/75">Esc</kbd> Close</span>
        </span>
      </div>
    </section>
  )
}

export function ComposerSuggestionItem({ selected, className, ...props }: ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground/40",
        selected ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
        className,
      )}
      {...props}
    />
  )
}
