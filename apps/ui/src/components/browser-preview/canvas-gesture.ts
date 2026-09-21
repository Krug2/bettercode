export type CanvasWheel = { x: number; y: number; deltaY: number }

export function readCanvasWheel(value: unknown): CanvasWheel | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("x" in value) ||
    !("y" in value) ||
    !("deltaY" in value)
  )
    return null
  const { x, y, deltaY } = value
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof deltaY !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(deltaY) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1
  )
    return null
  return { x, y, deltaY: Math.max(-1000, Math.min(1000, deltaY)) }
}

/** Re-enter the host's existing wheel pipeline at the guest's screen position. */
export function forwardCanvasWheel(view: HTMLElement, value: unknown): void {
  const wheel = readCanvasWheel(value)
  if (!wheel) return
  const rect = view.getBoundingClientRect()
  view.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: rect.left + rect.width * wheel.x,
      clientY: rect.top + rect.height * wheel.y,
      deltaY: wheel.deltaY,
      deltaMode: 0,
    })
  )
}
