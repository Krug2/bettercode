import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react"
import type { Point } from "./graph-data"
import { useUsageGraphStore, type UsageLayout } from "./graph-store"
import type { useBlobScene } from "./use-blob-scene"
import { zoomCamera } from "./graph-camera"

interface Gesture {
  pointer: number
  id: string | null
  start: Point
  origin: Point
  camera: UsageLayout["camera"]
  moved: boolean
}

export function useBlobInput(scene: ReturnType<typeof useBlobScene>, stage: RefObject<HTMLDivElement | null>, onManualMove: () => void) {
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const { currentCamera } = scene

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || !Number.isFinite(event.deltaY)) return
      event.preventDefault()
      if (gesture.current) return
      onManualMove()
      const bounds = element.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1
      const delta = Math.max(-240, Math.min(240, event.deltaY * unit))
      const store = useUsageGraphStore.getState()
      store.setCamera(zoomCamera(currentCamera.current, store.camera.zoom * Math.exp(-delta * 0.002), {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      }))
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [stage, currentCamera, onManualMove])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current) return
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-blob]")
    const id = button?.dataset.blob ?? null
    const body = id ? scene.physics.bodies.get(id) : null
    const camera = { ...scene.currentCamera.current }
    gesture.current = { pointer: event.pointerId, id, start: { x: event.clientX, y: event.clientY }, origin: body ? { x: body.x, y: body.y } : camera, camera, moved: false }
    suppressClick.current = false
    ;(button ?? event.currentTarget).setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y
    if (!active.moved && Math.hypot(dx, dy) < 5) return
    event.preventDefault()
    active.moved = true
    onManualMove()
    if (active.id) {
      scene.physics.moveBranch(active.id, { x: active.origin.x + dx / active.camera.zoom, y: active.origin.y + dy / active.camera.zoom }, scene.reducedMotion)
      scene.wake()
    } else {
      useUsageGraphStore.getState().setCamera({ ...active.camera, x: active.origin.x + dx, y: active.origin.y + dy })
    }
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = null
    suppressClick.current = active.moved
    if (active.id && active.moved) {
      useUsageGraphStore.getState().move(scene.physics.releaseBranch())
      scene.wake()
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
    const direction = directions[event.key], body = scene.physics.bodies.get(id)
    if (!direction || !body) return
    event.preventDefault()
    onManualMove()
    const distance = event.shiftKey ? 60 : 20
    scene.physics.moveBranch(id, { x: body.x + direction.x * distance, y: body.y + direction.y * distance }, scene.reducedMotion)
    useUsageGraphStore.getState().move(scene.physics.releaseBranch())
    scene.wake()
  }

  return {
    onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
    onClickCapture: (event: { preventDefault(): void; stopPropagation(): void }) => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
    },
    onKeyDown,
  }
}
