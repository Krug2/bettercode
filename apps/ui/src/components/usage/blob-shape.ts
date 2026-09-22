export function blobShape(radius: number, phase: number, stretch: number, direction: number): string {
  const count = 10
  const points = Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2
    const organic = 1 + 0.03 * Math.sin(angle * 3 + phase) + 0.02 * Math.cos(angle * 2 - phase)
    const r = radius * organic * (1 + stretch * Math.cos(2 * (angle - direction)))
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  })
  const point = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`
  let path = `M${point(points[0].x, points[0].y)}`
  for (let i = 0; i < count; i++) {
    const a = points[(i + count - 1) % count], b = points[i], c = points[(i + 1) % count], d = points[(i + 2) % count]
    path += ` C${point(b.x + (c.x - a.x) / 6, b.y + (c.y - a.y) / 6)} ${point(c.x - (d.x - b.x) / 6, c.y - (d.y - b.y) / 6)} ${point(c.x, c.y)}`
  }
  return path + " Z"
}
