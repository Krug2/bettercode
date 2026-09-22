import { descendants, ROOT_BLOB, type BlobNode, type Point } from "./graph-data"
import { blobTargets, separateTargets } from "./graph-layout"

export interface BlobBody extends Point {
  node: BlobNode
  target: Point
  vx: number
  vy: number
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
        body = { node, ...target, target, vx: 0, vy: 0, scale: 0, scaleVelocity: 0, wobble: 0, wobbleVelocity: 0, phase: [...node.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 628, 0) / 100, visible: false, closing: false, launching: false, delay: 0 }
        this.bodies.set(node.id, body)
      }
      body.node = node; body.target = target
      if (instant) {
        Object.assign(body, target, { visible: active.has(node.id), closing: false, launching: false, scale: 1, scaleVelocity: 0, vx: 0, vy: 0, wobble: 0, wobbleVelocity: 0 })
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
        const dx = body.target.x - body.x, dy = body.target.y - body.y, distance = Math.hypot(dx, dy) || 1
        body.vx = dx / distance * 21; body.vy = dy / distance * 21
        body.wobbleVelocity = 0.075; body.visible = true; body.launching = false
        if (parent && parent.node.id !== this.dragging) { parent.vx -= dx / distance * 1.8; parent.vy -= dy / distance * 1.8 }
      }
      if (!body.visible || body.node.id === this.dragging) continue
      const target = body.closing ? this.bodies.get(body.node.parent ?? "") ?? body.target : body.target
      body.vx = (body.vx + (target.x - body.x) * 0.04 * dt) * Math.pow(0.83, dt)
      body.vy = (body.vy + (target.y - body.y) * 0.04 * dt) * Math.pow(0.83, dt)
      body.x += body.vx * dt; body.y += body.vy * dt
      body.scaleVelocity = (body.scaleVelocity + ((body.closing ? 0 : 1) - body.scale) * 0.15 * dt) * Math.pow(0.68, dt)
      body.scale = Math.max(0, Math.min(1.08, body.scale + body.scaleVelocity * dt))
      body.wobbleVelocity = (body.wobbleVelocity - body.wobble * 0.17 * dt) * Math.pow(0.72, dt)
      body.wobble += body.wobbleVelocity * dt
      if (body.closing && body.scale < 0.025) { body.visible = false; body.closing = false }
      energy += Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.scaleVelocity) * 30 + Math.abs(body.wobbleVelocity) * 30
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
    }
  }
}
