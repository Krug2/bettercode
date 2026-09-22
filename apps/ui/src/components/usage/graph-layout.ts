import { type BlobNode, type Point, ROOT_BLOB } from "./graph-data"

export function blobTargets(nodes: BlobNode[], positions: Record<string, Point>): Map<string, Point> {
  const targets = new Map<string, Point>()
  for (const node of nodes) {
    const parent = targets.get(node.parent ?? "") ?? { x: 0, y: 0 }
    targets.set(node.id, positions[node.id] ? { ...positions[node.id] } : { x: parent.x + node.offset.x, y: parent.y + node.offset.y })
  }
  return targets
}

export function separateTargets(nodes: BlobNode[], targets: Map<string, Point>, positions: Record<string, Point>): void {
  for (let pass = 0; pass < 180; pass++) {
    let overlap = false
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], pa = targets.get(a.id)!, pb = targets.get(b.id)!
      const dx = pb.x - pa.x || 0.01, dy = pb.y - pa.y || 0.01
      const distance = Math.hypot(dx, dy), gap = (a.radius + b.radius) * 1.08 + 12
      if (distance >= gap) continue
      const fixedA = a.id === ROOT_BLOB || Object.hasOwn(positions, a.id)
      const fixedB = b.id === ROOT_BLOB || Object.hasOwn(positions, b.id)
      if (fixedA && fixedB) continue
      const share = fixedA ? 0 : fixedB ? 1 : 0.5
      const push = (gap - distance) * 0.6
      pa.x -= dx / distance * push * share; pa.y -= dy / distance * push * share
      pb.x += dx / distance * push * (1 - share); pb.y += dy / distance * push * (1 - share)
      overlap = true
    }
    if (!overlap) break
  }
}

function blobBounds(nodes: BlobNode[], targets: Map<string, Point>) {
  const left = Math.min(...nodes.map(node => targets.get(node.id)!.x - node.radius * 1.15))
  const right = Math.max(...nodes.map(node => targets.get(node.id)!.x + node.radius * 1.15))
  const top = Math.min(...nodes.map(node => targets.get(node.id)!.y - node.radius * 1.15))
  const bottom = Math.max(...nodes.map(node => targets.get(node.id)!.y + node.radius * 1.15))
  return { left, right, top, bottom }
}

export function graphHeight(nodes: BlobNode[], targets: Map<string, Point>, width: number, height: number, zoom: number) {
  const { left, right, top, bottom } = blobBounds(nodes, targets)
  const fittedZoom = Math.max(0.25, Math.min(zoom, (width - 56) / (right - left)))
  return Math.max(height, Math.min(960, Math.ceil((bottom - top) * fittedZoom + 56)))
}

export function fitBlobs(nodes: BlobNode[], targets: Map<string, Point>, width: number, height: number, maximumZoom = 1) {
  const { left, right, top, bottom } = blobBounds(nodes, targets)
  const padding = 28
  const zoom = Math.max(0.25, Math.min(maximumZoom, (width - padding * 2) / (right - left), (height - padding * 2) / (bottom - top)))
  return { x: -(left + right) / 2 * zoom, y: -(top + bottom) / 2 * zoom, zoom }
}
