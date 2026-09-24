import type { Point } from "./graph-data"

export interface ContactBody extends Point {
  node: { id: string; radius: number }
  scale: number
  phase: number
  vx: number
  vy: number
  pressure: Point
}

export function solveContacts<T extends ContactBody>(bodies: T[], dragging: string | null, dt: number, displace: (body: T, delta: Point, other: T) => void): number {
  const cellSize = Math.max(1, ...bodies.map(body => body.node.radius * body.scale * 1.9))
  const cells = new Map<string, number[]>()
  bodies.forEach((body, index) => {
    const key = `${Math.floor(body.x / cellSize)},${Math.floor(body.y / cellSize)}`
    const cell = cells.get(key) ?? []
    cell.push(index); cells.set(key, cell)
  })
  let energy = 0
  bodies.forEach((a, index) => {
    const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize)
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const other of cells.get(`${x},${y}`) ?? []) {
        if (other <= index) continue
        const b = bodies[other]
        let dx = b.x - a.x, dy = b.y - a.y
        const distance = Math.hypot(dx, dy)
        const ra = a.node.radius * a.scale * 0.95, rb = b.node.radius * b.scale * 0.95
        const gap = ra + rb, softness = Math.min(ra, rb) * 0.045
        if (distance >= gap) continue
        if (distance < 0.001) {
          dx = a.vx - b.vx; dy = a.vy - b.vy
          if (Math.hypot(dx, dy) < 0.001) { dx = Math.cos(a.phase + b.phase); dy = Math.sin(a.phase + b.phase) }
        }
        const length = Math.hypot(dx, dy), nx = dx / length, ny = dy / length
        const pressure = Math.min(0.18, (gap - distance) / Math.min(ra, rb) * 0.7)
        a.pressure.x -= (nx * nx - ny * ny) * pressure; a.pressure.y -= 2 * nx * ny * pressure
        b.pressure.x -= (nx * nx - ny * ny) * pressure; b.pressure.y -= 2 * nx * ny * pressure
        const penetration = gap - distance
        const push = Math.max(Math.max(0, penetration - softness) * (1 - Math.exp(-6 * dt)), penetration - Math.min(ra, rb) * 0.18)
        if (push < 0.002) continue
        const wa = a.node.id === dragging ? 0 : 1 / ra ** 2
        const wb = b.node.id === dragging ? 0 : 1 / rb ** 2
        const share = wa / (wa + wb)
        if (wa) {
          displace(a, { x: -nx * push * share, y: -ny * push * share }, b)
          const inward = Math.max(0, a.vx * nx + a.vy * ny)
          a.vx -= nx * inward; a.vy -= ny * inward
        }
        if (wb) {
          displace(b, { x: nx * push * (1 - share), y: ny * push * (1 - share) }, a)
          const inward = Math.min(0, b.vx * nx + b.vy * ny)
          b.vx -= nx * inward; b.vy -= ny * inward
        }
        energy += push
      }
    }
  })
  return energy
}
