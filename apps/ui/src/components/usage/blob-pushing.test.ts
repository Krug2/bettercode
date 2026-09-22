import { describe, expect, it } from "vitest"
import { BlobPhysics } from "./blob-physics"
import type { BlobNode } from "./graph-data"

const blob = (id: string, parent: string | null = null): BlobNode => ({ id, parent, model: id, label: id, value: "10", hint: "tokens", amount: 10, unit: "tokens", intensity: 0.5, radius: 50, offset: { x: 0, y: 150 }, children: [] })
const tick = (engine: BlobPhysics, frames = 240) => { for (let i = 0; i < frames; i++) engine.step(16.667) }

describe("blob pushing", () => {
  it("keeps small neighbors ahead of a fast drag instead of flipping contact sides", () => {
    const nodes = [blob("a"), blob("b")].map(node => ({ ...node, radius: 34 })), engine = new BlobPhysics()
    engine.sync(nodes, nodes, { a: { x: -67, y: 0 }, b: { x: 0, y: 0 } }, true)
    const a = engine.bodies.get("a")!, b = engine.bodies.get("b")!
    engine.moveBranch("a", { x: 1200, y: 0 })
    for (let frame = 0; frame < 30; frame++) {
      engine.step(32)
      expect(b.x).toBeGreaterThan(a.x + 58)
    }
  })

  it("pushes through a fast drag without tunneling or pulling the neighbor backward", () => {
    const nodes = [blob("a"), blob("b")], engine = new BlobPhysics()
    engine.sync(nodes, nodes, { a: { x: -250, y: 0 }, b: { x: 0, y: 0 } }, true)
    const a = engine.bodies.get("a")!, b = engine.bodies.get("b")!
    engine.moveBranch("a", { x: 300, y: 0 })
    engine.step(32)
    expect(b.x).toBeGreaterThan(150)
    let previous = b.x
    for (let frame = 0; frame < 120; frame++) {
      engine.step(16.667)
      expect(b.x).toBeGreaterThanOrEqual(previous - 0.05)
      previous = b.x
    }
    expect(a.x).toBeCloseTo(300, 5)
    expect(b.x - a.x).toBeGreaterThan(92)
    expect(b.x - a.x).toBeLessThan(95)
    expect(a.strain.x).toBeLessThan(-0.01)
    expect(b.strain.x).toBeLessThan(-0.01)
  })

  it("carries the pushed branch and preserves its new resting positions", () => {
    const nodes = [blob("a"), { ...blob("b"), children: ["c"] }, blob("c", "b")], engine = new BlobPhysics()
    engine.sync(nodes, nodes, { a: { x: -200, y: 0 }, b: { x: 0, y: 0 } }, true)
    engine.moveBranch("a", { x: 160, y: 0 })
    const saved = engine.releaseBranch()
    tick(engine)
    Object.assign(saved, engine.takePositions())
    const b = engine.bodies.get("b")!, c = engine.bodies.get("c")!
    expect(b.x).toBeGreaterThan(240)
    expect(engine.bodies.get("a")!.x).toBeCloseTo(160, 1)
    expect(c.x).toBeCloseTo(b.x, 2)
    const restored = new BlobPhysics()
    restored.sync(nodes, nodes, saved, true)
    tick(restored)
    expect(restored.bodies.get("b")!.x).toBeCloseTo(b.x, 2)
    expect(restored.bodies.get("c")!.x).toBeCloseTo(c.x, 2)
  })

  it("settles a pile without jitter and still resolves contacts with reduced motion", () => {
    const nodes = [blob("a"), blob("b"), blob("c")], engine = new BlobPhysics()
    engine.sync(nodes, nodes, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }, true)
    tick(engine)
    const settled = [...engine.bodies.values()].map(body => ({ x: body.x, y: body.y }))
    tick(engine, 120)
    for (const [index, body] of [...engine.bodies.values()].entries()) {
      expect(Math.hypot(body.x - settled[index].x, body.y - settled[index].y)).toBeLessThan(0.05)
    }
    engine.moveBranch("a", { ...engine.bodies.get("b")!.target }, true)
    engine.step(16.667, true)
    for (const body of engine.bodies.values()) expect(body.slosh).toEqual({ x: 0, y: 0 })
    const a = engine.bodies.get("a")!, b = engine.bodies.get("b")!
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(92)
  })
})
