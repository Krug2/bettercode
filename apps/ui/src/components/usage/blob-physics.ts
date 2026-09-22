import { descendants, ROOT_BLOB, type BlobNode, type Point } from "./graph-data"
import { blobTargets, separateTargets } from "./graph-layout"

export interface BlobBody extends Point {
  node: BlobNode
  target: Point
  vx: number
  vy: number
  previous: Point
  motion: Point
  slosh: Point
  sloshVelocity: Point
  strain: Point
  scale: number
  scaleVelocity: number
  wobble: number
  wobbleVelocity: number
  phase: number
  visible: boolean
  closing: boolean
  launching: boolean
  delay: number
}

export class BlobPhysics {
  readonly bodies = new Map<string, BlobBody>()
  private nodes: BlobNode[] = []
  private pinned = new Set<string>()
  dragging: string | null = null

  sync(nodes: BlobNode[], visible: BlobNode[], positions: Record<string, Point>, instant: boolean): void {
    this.nodes = nodes
    this.pinned = new Set([ROOT_BLOB, ...Object.keys(positions)])
    const targets = blobTargets(nodes, positions)
    separateTargets(visible, targets, positions)
    const active = new Set(visible.map(node => node.id)), ids = new Set(nodes.map(node => node.id))
    const depth = new Map<string, number>()
    nodes.forEach(node => depth.set(node.id, node.parent ? (depth.get(node.parent) ?? 0) + 1 : 0))
    const opening = visible.filter(node => !this.bodies.get(node.id)?.visible || this.bodies.get(node.id)?.closing)
    const firstDepth = Math.min(...opening.map(node => depth.get(node.id)!))
    for (const id of this.bodies.keys()) if (!ids.has(id)) this.bodies.delete(id)
    for (const node of nodes) {
      const target = targets.get(node.id)!
      let body = this.bodies.get(node.id)
      if (!body) {
        body = { node, ...target, target, vx: 0, vy: 0, previous: { ...target }, motion: { x: 0, y: 0 }, slosh: { x: 0, y: 0 }, sloshVelocity: { x: 0, y: 0 }, strain: { x: 0, y: 0 }, scale: 0, scaleVelocity: 0, wobble: 0, wobbleVelocity: 0, phase: [...node.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 628, 0) / 100, visible: false, closing: false, launching: false, delay: 0 }
        this.bodies.set(node.id, body)
      }
      body.node = node; body.target = target
      if (instant) {
        Object.assign(body, target, { visible: active.has(node.id), closing: false, launching: false, scale: 1, scaleVelocity: 0, vx: 0, vy: 0, wobble: 0, wobbleVelocity: 0 })
        this.stillContents(body)
      } else if (active.has(node.id)) {
        if ((!body.visible || body.closing) && !body.launching) {
          body.launching = true; body.visible = false; body.scale = 0.08
          const siblings = nodes.find(parent => parent.id === node.parent)?.children ?? [node.id]
          body.delay = (depth.get(node.id)! - firstDepth) * 110 + siblings.indexOf(node.id) * 32
        }
        body.closing = false
      } else {
        body.closing = body.visible; body.launching = false
      }
    }
  }

  step(milliseconds: number): number {
    const dt = Math.max(0.25, Math.min(2, milliseconds / 16.667))
    let energy = 0
    const bodies = [...this.bodies.values()]
    for (const body of bodies) {
      if (body.launching) {
        body.delay -= milliseconds; energy++
        if (body.delay > 0) continue
        const parent = this.bodies.get(body.node.parent ?? "")
        body.x = parent?.x ?? body.target.x; body.y = parent?.y ?? body.target.y
        this.stillContents(body)
        const dx = body.target.x - body.x, dy = body.target.y - body.y, distance = Math.hypot(dx, dy) || 1
        body.vx = dx / distance * 21; body.vy = dy / distance * 21
        body.wobbleVelocity = 0.02; body.visible = true; body.launching = false
        if (parent && parent.node.id !== this.dragging) { parent.vx -= dx / distance * 0.8; parent.vy -= dy / distance * 0.8 }
      }
      if (!body.visible) continue
      if (body.node.id !== this.dragging) {
        const target = body.closing ? this.bodies.get(body.node.parent ?? "") ?? body.target : body.target
        body.vx = (body.vx + (target.x - body.x) * 0.055 * dt) * Math.pow(0.64, dt)
        body.vy = (body.vy + (target.y - body.y) * 0.055 * dt) * Math.pow(0.64, dt)
        body.x += body.vx * dt; body.y += body.vy * dt
      }
      const motion = { x: (body.x - body.previous.x) / dt, y: (body.y - body.previous.y) / dt }
      const limit = body.node.radius * 0.075
      body.motion.x += (motion.x - body.motion.x) * (1 - Math.exp(-dt * 0.32))
      body.motion.y += (motion.y - body.motion.y) * (1 - Math.exp(-dt * 0.32))
      const speed = Math.hypot(body.motion.x, body.motion.y)
      const lag = Math.min(0.22, limit / (speed || 1))
      for (const axis of ["x", "y"] as const) {
        const target = -body.motion[axis] * lag
        body.sloshVelocity[axis] = (body.sloshVelocity[axis] + (target - body.slosh[axis]) * 0.18 * dt) * Math.pow(0.48, dt)
        body.slosh[axis] += body.sloshVelocity[axis] * dt
      }
      const slosh = Math.hypot(body.slosh.x, body.slosh.y)
      if (slosh > limit) {
        body.slosh.x *= limit / slosh; body.slosh.y *= limit / slosh
        body.sloshVelocity.x *= 0.5; body.sloshVelocity.y *= 0.5
      }
      body.previous = { x: body.x, y: body.y }
      body.scaleVelocity = (body.scaleVelocity + ((body.closing ? 0 : 1) - body.scale) * 0.15 * dt) * Math.pow(0.68, dt)
      body.scale = Math.max(0, Math.min(1.03, body.scale + body.scaleVelocity * dt))
      body.wobbleVelocity = (body.wobbleVelocity - body.wobble * 0.1 * dt) * Math.pow(0.58, dt)
      body.wobble = Math.max(-0.035, Math.min(0.035, body.wobble + body.wobbleVelocity * dt))
      const stretch = Math.min(0.07, speed * 0.0018) + body.wobble
      const strain = speed > 0.01 ? {
        x: stretch * (body.motion.x ** 2 - body.motion.y ** 2) / speed ** 2,
        y: stretch * 2 * body.motion.x * body.motion.y / speed ** 2,
      } : { x: 0, y: 0 }
      for (const axis of ["x", "y"] as const) {
        const change = (strain[axis] - body.strain[axis]) * (1 - Math.exp(-dt * 0.18))
        body.strain[axis] += change
        energy += Math.abs(change) * 80
      }
      if (body.closing && body.scale < 0.025) { body.visible = false; body.closing = false }
      energy += Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.scaleVelocity) * 30 + Math.abs(body.wobbleVelocity) * 30
      energy += Math.hypot(body.sloshVelocity.x, body.sloshVelocity.y) + slosh * 0.2 + Math.abs(body.wobble) * 5
    }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j]
      if (!a.visible || !b.visible || a.closing || b.closing) continue
      if ((a.node.parent === b.node.id && a.scale < 0.8) || (b.node.parent === a.node.id && b.scale < 0.8)) continue
      const dx = b.x - a.x || 0.01, dy = b.y - a.y || 0.01, distance = Math.hypot(dx, dy)
      const gap = (a.node.radius * a.scale + b.node.radius * b.scale) * 1.04 + 5
      if (distance >= gap) continue
      const fixedA = a.node.id === this.dragging || this.pinned.has(a.node.id)
      const fixedB = b.node.id === this.dragging || this.pinned.has(b.node.id)
      if (fixedA && fixedB) continue
      const share = fixedA ? 0 : fixedB ? 1 : 0.5
      const push = (gap - distance) * 0.6
      a.x -= dx / distance * push * share; a.y -= dy / distance * push * share
      b.x += dx / distance * push * (1 - share); b.y += dy / distance * push * (1 - share)
      a.wobbleVelocity -= 0.002; b.wobbleVelocity += 0.002
    }
    return energy
  }

  moveBranch(id: string, point: Point, instant = false): void {
    const parent = this.bodies.get(id)
    if (!parent) return
    const dx = point.x - parent.x, dy = point.y - parent.y
    this.dragging = id
    for (const child of descendants(this.nodes, id)) {
      const body = this.bodies.get(child)!
      body.target = { x: body.target.x + dx, y: body.target.y + dy }
      if (child === id || instant || !body.visible) { body.x += dx; body.y += dy; body.vx = body.vy = 0 }
      if (instant) { this.stillContents(body); body.wobble = body.wobbleVelocity = 0 }
    }
    parent.target = { ...point }
  }

  releaseBranch(): Record<string, Point> {
    if (!this.dragging) return {}
    const positions = Object.fromEntries([...descendants(this.nodes, this.dragging)].map(id => [id, { ...this.bodies.get(id)!.target }]))
    this.dragging = null
    return positions
  }

  settle(): void {
    for (const body of this.bodies.values()) {
      body.vx = body.vy = body.scaleVelocity = body.wobble = body.wobbleVelocity = 0
      if (body.closing) { body.visible = false; body.closing = false }
      body.scale = 1
      this.stillContents(body)
    }
  }

  private stillContents(body: BlobBody): void {
    body.previous = { x: body.x, y: body.y }
    body.motion = { x: 0, y: 0 }
    body.slosh = { x: 0, y: 0 }
    body.sloshVelocity = { x: 0, y: 0 }
    body.strain = { x: 0, y: 0 }
  }
}
