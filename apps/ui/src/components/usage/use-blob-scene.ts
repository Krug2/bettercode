import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { BlobPhysics } from "./blob-physics"
import { blobShape } from "./blob-shape"
import type { BlobNode, Point } from "./graph-data"
import type { UsageLayout } from "./graph-store"

export function useBlobScene(nodes: BlobNode[], visible: BlobNode[], positions: Record<string, Point>, camera: UsageLayout["camera"]) {
  const [physics] = useState(() => new BlobPhysics())
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const shapes = useRef(new Map<string, SVGPathElement>())
  const links = useRef(new Map<string, SVGPathElement>())
  const world = useRef<HTMLDivElement>(null)
  const currentCamera = useRef({ ...camera })
  const targetCamera = useRef(camera)
  const frame = useRef(0)
  const initialized = useRef(false)

  const paint = useCallback(() => {
    const view = currentCamera.current
    if (world.current) world.current.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
    for (const [id, body] of physics.bodies) {
      const button = buttons.current.get(id)
      if (button) {
        button.hidden = !body.visible
        button.style.transform = `translate(${body.x - body.node.radius}px, ${body.y - body.node.radius}px) scale(${body.scale})`
      }
      if (body.visible) {
        const speed = Math.hypot(body.vx, body.vy)
        shapes.current.get(id)?.setAttribute("d", blobShape(body.node.radius * 0.95, body.phase, Math.min(0.14, speed * 0.003) + body.wobble, Math.atan2(body.vy, body.vx)))
      }
      const link = links.current.get(id), parent = physics.bodies.get(body.node.parent ?? "")
      if (!link || !parent) continue
      const distance = Math.hypot(body.x - parent.x, body.y - parent.y)
      link.style.visibility = body.visible && parent.visible && distance > parent.node.radius ? "visible" : "hidden"
      link.style.opacity = String(Math.min(body.scale, parent.scale, 1))
      const middle = (body.x + parent.x) / 2
      link.setAttribute("d", `M${parent.x},${parent.y} C${middle},${parent.y} ${middle},${body.y} ${body.x},${body.y}`)
    }
  }, [physics])

  const wake = useCallback(() => {
    if (frame.current) return
    let previous = performance.now(), steps = 0
    const tick = (now: number) => {
      const elapsed = Math.min(32, now - previous)
      previous = now
      const energy = physics.step(elapsed)
      const current = currentCamera.current, target = targetCamera.current
      const cameraEnergy = Math.abs(current.x - target.x) + Math.abs(current.y - target.y) + Math.abs(current.zoom - target.zoom) * 500
      const rate = reducedMotion ? 1 : 1 - Math.pow(0.82, elapsed / 16.667)
      current.x += (target.x - current.x) * rate
      current.y += (target.y - current.y) * rate
      current.zoom += (target.zoom - current.zoom) * rate
      paint()
      if ((energy > 0.025 || cameraEnergy > 0.1) && ++steps < 600) {
        frame.current = requestAnimationFrame(tick)
      } else {
        physics.settle()
        currentCamera.current = { ...target }
        paint()
        frame.current = 0
      }
    }
    frame.current = requestAnimationFrame(tick)
  }, [paint, physics, reducedMotion])

  useLayoutEffect(() => {
    if (physics.dragging) return
    physics.sync(nodes, visible, positions, !initialized.current || reducedMotion)
    initialized.current = true
    paint()
    wake()
  }, [nodes, visible, positions, physics, paint, wake, reducedMotion])

  useLayoutEffect(() => {
    targetCamera.current = camera
    wake()
  }, [camera, wake])

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])

  return { physics, buttons, shapes, links, world, currentCamera, wake, reducedMotion }
}
