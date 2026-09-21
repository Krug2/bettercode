import { useEffect, useState } from "react"

/**
 * The value once it has stopped changing for `delayMs`. A pinch or wheel
 * zoom updates the canvas every frame; work that is expensive per change
 * (re-rasterising a guest page at a new zoom factor) follows this instead.
 */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
