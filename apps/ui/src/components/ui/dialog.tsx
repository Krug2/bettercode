import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function containsDialogDescription(node: React.ReactNode): boolean {
  if (node == null || typeof node === "boolean") return false
  if (Array.isArray(node)) return node.some(containsDialogDescription)
  if (!React.isValidElement(node)) return false
  const type = node.type as unknown
  if (type === DialogPrimitive.Description || type === DialogDescription) return true
  const childChildren = (node.props as { children?: React.ReactNode } | null | undefined)?.children
  return childChildren != null ? containsDialogDescription(childChildren) : false
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Radix warns when no <DialogDescription> is rendered and the consumer didn't
  // explicitly opt out via aria-describedby={undefined}. Default to the opt-out
  // when we can't find a Description child, so callers without one stay silent
  // without losing Radix's auto-linking when a Description IS present.
  const callerSetDescribedBy = "aria-describedby" in props
  const silenceWarning = !callerSetDescribedBy && !containsDialogDescription(children)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // bg-sidebar (#141414) — overlay modals sit on the shell-chrome
          // tone of the two-color theme, not the lighter popover grey.
          //
          // `grid-cols-[minmax(0,1fr)]` is load-bearing, not cosmetic. A grid
          // item defaults to `min-width: auto`, so the implicit column refuses
          // to shrink below its content's intrinsic minimum: one long inline
          // `<code>`, a wide `<pre>`, or a table stretches the column past
          // `max-w` and EVERY row inherits that width. That is why an
          // overflowing plan preview also pushed the footer buttons off the
          // dialog — the content was not too wide, the column was. Pinning the
          // column to the container makes `overflow-wrap` and `overflow-x:auto`
          // on the children actually take effect.
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-4xl bg-sidebar p-6 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/5 duration-100 outline-none sm:max-w-md dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...(silenceWarning ? { "aria-describedby": undefined } : {})}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-4 right-4 bg-secondary"
              size="icon-sm"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // `flex-wrap` so a footer with three actions wraps to a second row
        // instead of overflowing the dialog and clipping the primary button —
        // the one the user most needs to reach.
        "flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
