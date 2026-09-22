import { descendants, type BlobNode, type Point } from "./graph-data"
import { blobTargets, separateTargets } from "./graph-layout"
import { solveContacts } from "./blob-contacts"

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
  pressure: Point
  scale: number
  scaleVelocity: number
  wobble: number
  wobbleVelocity: number
  phase: number
  visible: boolean
  closing: boolean
  launching: boolean
  emerging: boolean
  delay: number
}

export class BlobPhysics {
  readonly bodies = new Map<string, BlobBody>()
  private branches = new Map<string, Set<string>>()
  private changed = new Set<string>()
  private positions: Record<string, Point> = {}
  private released: string | null = null
  dragging: string | null = null

  sync(nodes: BlobNode[], visible: BlobNode[], positions: Record<string, Point>, instant: boolean): void {
    this.branches = new Map(nodes.map(node => [node.id, descendants(nodes, node.id)]))
    if (positions !== this.positions) this.changed.clear()
    this.positions = positions
    const placement = { ...positions }
    for (const id of this.changed) if (this.bodies.has(id)) placement[id] = this.bodies.get(id)!.target
    const targets = blobTargets(nodes, placement)
    separateTargets(visible, targets, placement)
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
        body = { node, ...target, target, vx: 0, vy: 0, previous: { ...target }, motion: { x: 0, y: 0 }, slosh: { x: 0, y: 0 }, sloshVelocity: { x: 0, y: 0 }, strain: { x: 0, y: 0 }, pressure: { x: 0, y: 0 }, scale: 0, scaleVelocity: 0, wobble: 0, wobbleVelocity: 0, phase: [...node.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 628, 0) / 100, visible: false, closing: false, launching: false, emerging: false, delay: 0 }
        this.bodies.set(node.id, body)
      }
      body.node = node; body.target = target
      if (instant) {
        Object.assign(body, target, { visible: active.has(node.id), closing: false, launching: false, emerging: false, scale: 1, scaleVelocity: 0, vx: 0, vy: 0, wobble: 0, wobbleVelocity: 0 })
        this.stillContents(body)
      } else if (active.has(node.id)) {
        if ((!body.visible || body.closing) && !body.launching) {
          body.launching = true; body.emerging = true; body.visible = false; body.scale = 0.08
          const siblings = nodes.find(parent => parent.id === node.parent)?.children ?? [node.id]
          body.delay = (depth.get(node.id)! - firstDepth) * 110 + siblings.indexOf(node.id) * 32
        }
        body.closing = false
      } else {
        body.closing = body.visible; body.launching = false
      }
    }
  }

  step(milliseconds: number, instant = false): number {
    if (milliseconds <= 0) return 1
    if (instant) {
      let energy = 0
      for (let pass = 0; pass < 64; pass++) {
        energy = this.advance(16.667, true)
        if (energy < 0.025) break
      }
      return energy
    }
    const elapsed = Math.min(48, milliseconds), dragged = this.bodies.get(this.dragging ?? this.released ?? "")
    const travel = dragged ? Math.hypot(dragged.target.x - dragged.x, dragged.target.y - dragged.y) * (1 - Math.exp(-elapsed / 16.667 * 0.85)) : 0
    const slices = Math.min(64, Math.max(1, Math.ceil(elapsed / 8.333), Math.ceil(travel / 12)))
    let energy = 0
    for (let slice = 0; slice < slices; slice++) energy = this.advance(elapsed / slices)
    return energy
  }

  private advance(milliseconds: number, instant = false): number {
    const dt = milliseconds / 16.667
    let energy = 0
    const bodies = [...this.bodies.values()]
    for (const body of bodies) {
      body.pressure = { x: 0, y: 0 }
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
      if (instant) {
        body.x = body.target.x; body.y = body.target.y
        body.vx = body.vy = 0; body.emerging = false
      } else if (body.node.id === this.dragging || body.node.id === this.released) {
        const rate = 1 - Math.exp(-dt * 0.85)
        body.vx = (body.target.x - body.x) * rate / dt
        body.vy = (body.target.y - body.y) * rate / dt
        body.x += body.vx * dt; body.y += body.vy * dt
        if (body.node.id === this.released && Math.hypot(body.target.x - body.x, body.target.y - body.y) < 0.02) {
          body.x = body.target.x; body.y = body.target.y; body.vx = body.vy = 0
          this.released = null
        }
      } else {
        const target = body.closing ? this.bodies.get(body.node.parent ?? "") ?? body.target : body.target
        body.vx = (body.vx + (target.x - body.x) * 0.055 * dt) * Math.pow(0.64, dt)
        body.vy = (body.vy + (target.y - body.y) * 0.055 * dt) * Math.pow(0.64, dt)
        body.x += body.vx * dt; body.y += body.vy * dt
      }
      body.scaleVelocity = (body.scaleVelocity + ((body.closing ? 0 : 1) - body.scale) * 0.15 * dt) * Math.pow(0.68, dt)
      body.scale = Math.max(0, Math.min(1.03, body.scale + body.scaleVelocity * dt))
      if (body.emerging && body.scale > 0.99 && Math.hypot(body.target.x - body.x, body.target.y - body.y) < 12) body.emerging = false
      if (body.closing && body.scale < 0.025) { body.visible = false; body.closing = false }
    }
    if (instant) this.released = null
    energy += solveContacts(bodies.filter(body => body.visible && !body.closing && !body.emerging && body.scale > 0.9), this.dragging ?? this.released, dt, (body, delta, other) => this.displace(body, delta, other))
    for (const body of bodies) {
      if (!body.visible) continue
      if (instant) this.stillContents(body)
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
      body.wobbleVelocity = (body.wobbleVelocity - body.wobble * 0.1 * dt) * Math.pow(0.58, dt)
      body.wobble = Math.max(-0.035, Math.min(0.035, body.wobble + body.wobbleVelocity * dt))
      const stretch = Math.min(0.07, speed * 0.0018) + body.wobble
      const strain = speed > 0.01 ? {
        x: stretch * (body.motion.x ** 2 - body.motion.y ** 2) / speed ** 2,
        y: stretch * 2 * body.motion.x * body.motion.y / speed ** 2,
      } : { x: 0, y: 0 }
      strain.x += body.pressure.x; strain.y += body.pressure.y
      const deformation = Math.hypot(strain.x, strain.y)
      if (deformation > 0.18) { strain.x *= 0.18 / deformation; strain.y *= 0.18 / deformation }
      for (const axis of ["x", "y"] as const) {
        const change = (strain[axis] - body.strain[axis]) * (instant ? 1 : 1 - Math.exp(-dt * 0.18))
        body.strain[axis] += change
        if (!instant) energy += Math.abs(change) * 80
      }
      energy += Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.scaleVelocity) * 30 + Math.abs(body.wobbleVelocity) * 30
      energy += Math.hypot(body.sloshVelocity.x, body.sloshVelocity.y) + slosh * 0.2 + Math.abs(body.wobble) * 5
    }
    return energy
  }

  private displace(body: BlobBody, delta: Point, other: BlobBody): void {
    const length = Math.hypot(delta.x, delta.y), nx = delta.x / length, ny = delta.y / length
    const blocked = Math.min(0, (body.target.x - body.x) * nx + (body.target.y - body.y) * ny)
    const shift = { x: delta.x - nx * blocked, y: delta.y - ny * blocked }
    const branch = this.branches.get(body.node.id)!
    const moved = branch.has(other.node.id) ? [body.node.id] : branch
    const held = this.branches.get(this.dragging ?? this.released ?? "")
    for (const id of moved) {
      if (held?.has(id)) continue
      const child = this.bodies.get(id)!
      child.target = { x: child.target.x + shift.x, y: child.target.y + shift.y }
      this.changed.add(id)
    }
    body.x += delta.x; body.y += delta.y
    this.changed.add(other.node.id)
  }

  moveBranch(id: string, point: Point, instant = false): void {
    const parent = this.bodies.get(id)
    if (!parent) return
    const dx = point.x - parent.target.x, dy = point.y - parent.target.y
    this.dragging = id
    this.released = null
    parent.emerging = false
    for (const child of this.branches.get(id)!) {
      const body = this.bodies.get(child)!
      body.target = { x: body.target.x + dx, y: body.target.y + dy }
      this.changed.add(child)
      if (instant || !body.visible) { body.x = body.target.x; body.y = body.target.y; body.vx = body.vy = 0 }
      if (instant) { this.stillContents(body); body.wobble = body.wobbleVelocity = 0 }
    }
    parent.target = { ...point }
  }

  releaseBranch(): Record<string, Point> {
    if (!this.dragging) return {}
    const body = this.bodies.get(this.dragging)!
    body.vx = body.vy = 0
    this.released = this.dragging
    this.dragging = null
    return this.takePositions()
  }

  takePositions(): Record<string, Point> {
    if (!this.changed.size) return {}
    const positions = Object.fromEntries([...this.bodies.values()].filter(body => body.visible || this.changed.has(body.node.id)).map(body => [body.node.id, { ...body.target }]))
    this.changed.clear()
    return positions
  }

  settle(): void {
    this.released = null
    for (const body of this.bodies.values()) {
      body.vx = body.vy = body.scaleVelocity = body.wobble = body.wobbleVelocity = 0
      if (body.closing) { body.visible = false; body.closing = false }
      body.scale = 1
      this.stillContents(body, true)
    }
  }

  private stillContents(body: BlobBody, preserveStrain = false): void {
    body.previous = { x: body.x, y: body.y }
    body.motion = { x: 0, y: 0 }
    body.slosh = { x: 0, y: 0 }
    body.sloshVelocity = { x: 0, y: 0 }
    if (!preserveStrain) body.strain = { x: 0, y: 0 }
  }
}
