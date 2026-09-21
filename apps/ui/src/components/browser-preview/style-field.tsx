import { useEffect, useId, useRef, useState } from "react"
import { MoveHorizontalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  adjustStyleNumber,
  cssStyleValue,
  displayStyleValue,
  parseStyleNumber,
  styleStep,
} from "./style-value"

export function StyleField({
  label,
  displayLabel,
  value,
  unit,
  placeholder,
  className,
  min,
  max,
  numeric = true,
  onCommit,
}: {
  label: string
  displayLabel?: string
  value: string | undefined
  unit?: "px" | "%"
  placeholder?: string
  className?: string
  min?: number
  max?: number
  numeric?: boolean
  onCommit: (value: string) => void
}) {
  const id = useId()
  const display = displayStyleValue(value ?? "", unit)
  const [draft, setDraft] = useState(display)
  const [dragging, setDragging] = useState(false)
  const draftRef = useRef(display)
  const inputRef = useRef<HTMLInputElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const skipBlurRef = useRef(false)
  const editingStartRef = useRef(value ?? "")
  const parsed = numeric ? parseStyleNumber(draft) : null

  const updateDraft = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    if (!cleanupRef.current) {
      draftRef.current = display
      setDraft(display)
    }
  }, [display])
  useEffect(() => () => cleanupRef.current?.(), [])

  const commit = (next: string) => {
    const bounded = numeric ? adjustStyleNumber(next, 0, min, max) : null
    const result = bounded ?? next
    updateDraft(result)
    onCommit(cssStyleValue(result, unit))
  }

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !numeric || !parseStyleNumber(draftRef.current))
      return
    event.preventDefault()
    const target = event.currentTarget
    const pointerId = event.pointerId
    const original = value ?? ""
    let lastX = event.clientX
    let current = draftRef.current
    let changed = false
    let frame: number | null = null
    const publish = () => {
      frame = null
      onCommit(cssStyleValue(current, unit))
    }
    const previousCursor = document.body.style.cursor
    const previousSelection = document.body.style.userSelect
    document.body.style.cursor = "ew-resize"
    document.body.style.userSelect = "none"
    target.setPointerCapture(pointerId)
    setDragging(true)

    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelection
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("keydown", keydown, true)
      window.removeEventListener("blur", cancel)
      target.removeEventListener("lostpointercapture", cancel)
      cleanupRef.current = null
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId)
    }
    const end = (revert: boolean) => {
      cleanup()
      setDragging(false)
      if (changed) {
        if (revert) {
          updateDraft(displayStyleValue(original, unit))
          onCommit(original)
        } else publish()
      }
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      const delta =
        (next.clientX - lastX) * styleStep(next.shiftKey, next.altKey)
      lastX = next.clientX
      const adjusted = adjustStyleNumber(current, delta, min, max)
      if (adjusted === null || adjusted === current) return
      changed = true
      current = adjusted
      updateDraft(current)
      if (frame === null) frame = requestAnimationFrame(publish)
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId === pointerId) end(false)
    }
    const cancel = () => end(true)
    const keydown = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return
      next.preventDefault()
      next.stopImmediatePropagation()
      end(true)
    }
    cleanupRef.current = cleanup
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("keydown", keydown, true)
    window.addEventListener("blur", cancel)
    target.addEventListener("lostpointercapture", cancel)
  }

  return (
    <div
      className={cn("min-w-0 space-y-1", className)}
      data-style-field={label}
    >
      <label
        htmlFor={id}
        className="block truncate text-[11px] leading-4 text-muted-foreground"
      >
        {displayLabel ?? label}
      </label>
      <div
        className={cn(
          "flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border/60 bg-input/30 transition-colors focus-within:border-ring hover:border-border",
          dragging && "border-ring bg-input/60 ring-1 ring-ring/25"
        )}
      >
        {numeric && (
          <button
            type="button"
            aria-label={`Adjust ${label}`}
            title={
              parsed
                ? "Drag to adjust · Shift: ×10 · Alt: ×0.1 · Esc: cancel"
                : "Enter a number to enable dragging"
            }
            disabled={!parsed}
            className="grid h-8 w-7 shrink-0 touch-none place-items-center text-muted-foreground transition-colors focus-visible:outline focus-visible:outline-ring enabled:cursor-ew-resize enabled:hover:bg-muted/60 enabled:hover:text-foreground disabled:opacity-30"
            onPointerDown={startDrag}
            onClick={() => inputRef.current?.focus()}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
              const next = adjustStyleNumber(
                draftRef.current,
                (event.key === "ArrowUp" ? 1 : -1) *
                  styleStep(event.shiftKey, event.altKey),
                min,
                max
              )
              if (next !== null) {
                event.preventDefault()
                commit(next)
              }
            }}
          >
            <MoveHorizontalIcon className="size-3.5" aria-hidden="true" />
          </button>
        )}
        <input
          id={id}
          aria-label={label}
          ref={inputRef}
          role={parsed ? "spinbutton" : undefined}
          aria-valuenow={parsed?.number}
          aria-valuemin={parsed ? min : undefined}
          aria-valuemax={parsed ? max : undefined}
          className={cn(
            "h-full w-full min-w-0 flex-1 bg-transparent font-mono text-[12px] tabular-nums outline-none placeholder:text-muted-foreground/60",
            !numeric && "px-2.5"
          )}
          value={draft}
          spellCheck={false}
          placeholder={placeholder}
          title={numeric ? "Type a value or Shift-drag to adjust" : undefined}
          onPointerDown={(event) => {
            if (event.shiftKey) startDrag(event)
          }}
          onFocus={() => {
            editingStartRef.current = value ?? ""
          }}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => {
            if (!skipBlurRef.current && !cleanupRef.current)
              commit(draftRef.current)
            skipBlurRef.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit(draftRef.current)
              editingStartRef.current = cssStyleValue(draftRef.current, unit)
            } else if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              skipBlurRef.current = true
              updateDraft(displayStyleValue(editingStartRef.current, unit))
              onCommit(editingStartRef.current)
              event.currentTarget.blur()
            } else if (
              numeric &&
              (event.key === "ArrowUp" || event.key === "ArrowDown")
            ) {
              const next = adjustStyleNumber(
                draftRef.current,
                (event.key === "ArrowUp" ? 1 : -1) *
                  styleStep(event.shiftKey, event.altKey),
                min,
                max
              )
              if (next !== null) {
                event.preventDefault()
                commit(next)
              }
            }
          }}
        />
        {unit && parsed && !parsed.unit && (
          <span className="pr-2 text-[10px] text-muted-foreground select-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}
