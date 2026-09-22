import type { Point } from "./graph-data"
import type { UsageLayout } from "./graph-store"

export function zoomCamera(camera: UsageLayout["camera"], requestedZoom: number, anchor: Point = { x: 0, y: 0 }) {
  const zoom = Math.max(0.25, Math.min(2, requestedZoom)), ratio = zoom / camera.zoom
  return { x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio, zoom }
}
