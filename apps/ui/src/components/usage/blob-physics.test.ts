import { describe, expect, it } from "vitest"
import { BlobPhysics } from "./blob-physics"
import { usageNodes, visibleNodes } from "./graph-data"

const models = ["a", "b"].map(id => ({ id, model: id, provider: "local", input: 10, output: 2, calls: 1, unreported: 0, cost: null, inputCost: null, outputCost: null }))
const nodes = usageNodes(models)
const tick = (engine: BlobPhysics, frames = 200) => { for (let i = 0; i < frames; i++) engine.step(16.667) }

describe("blob motion", () => {
  it("launches new blobs from their parent before reaching their targets", () => {
    const engine = new BlobPhysics()
    engine.sync(nodes, visibleNodes(nodes, []), {}, true)
    engine.sync(nodes, visibleNodes(nodes, ["total"]), {}, false)
    engine.step(16.667)
    const body = engine.bodies.get("model:a")!
    expect(body.visible).toBe(true)
    expect(Math.hypot(body.x, body.y)).toBeLessThan(60)
    expect(Math.hypot(body.target.x, body.target.y)).toBeGreaterThan(150)
    tick(engine)
    expect(body.x).toBeCloseTo(body.target.x, 1)
  })

  it("moves descendants smoothly and preserves the released layout", () => {
    const engine = new BlobPhysics(), open = nodes.map(node => node.id)
    engine.sync(nodes, visibleNodes(nodes, open), {}, true)
    const parent = engine.bodies.get("model:a")!, child = engine.bodies.get("model:a:input")!
    const original = { x: child.x, y: child.y }, target = { ...child.target }
    const neighbor = { ...engine.bodies.get("model:b")!.target }
    engine.moveBranch(parent.node.id, { x: parent.x + 200, y: parent.y + 100 })
    expect(child.x).toBe(original.x)
    expect(child.target).toEqual({ x: target.x + 200, y: target.y + 100 })
    const saved = engine.releaseBranch()
    tick(engine)
    const restored = new BlobPhysics()
    restored.sync(nodes, visibleNodes(nodes, open), saved, true)
    expect(restored.bodies.get("model:a")!.target).toEqual(saved["model:a"])
    expect(restored.bodies.get("model:a:input")!.target).toEqual(saved["model:a:input"])
    expect(saved["model:b"]).toEqual(neighbor)
  })

  it("retracts collapsed branches and supports reduced motion", () => {
    const engine = new BlobPhysics()
    engine.sync(nodes, nodes, {}, true)
    engine.sync(nodes, visibleNodes(nodes, []), {}, false)
    tick(engine)
    expect([...engine.bodies.values()].filter(body => body.visible)).toHaveLength(1)
    engine.sync(nodes, nodes, {}, true)
    expect([...engine.bodies.values()].every(body => body.visible && body.scale === 1 && !body.launching)).toBe(true)
  })

  it("allows saved blobs to yield instead of remaining overlapped", () => {
    const engine = new BlobPhysics()
    const saved = { "model:a": { x: 100, y: 100 }, "model:b": { x: 130, y: 100 } }
    engine.sync(nodes, visibleNodes(nodes, ["total"]), saved, true)
    tick(engine)
    const a = engine.bodies.get("model:a")!, b = engine.bodies.get("model:b")!
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan((a.node.radius + b.node.radius) * 0.9)
    const settled = { x: a.x, y: a.y }
    tick(engine, 100)
    expect(Math.hypot(a.x - settled.x, a.y - settled.y)).toBeLessThan(0.01)
  })

  it("gently lags behind a drag and settles without moving the anchor", () => {
    const engine = new BlobPhysics()
    engine.sync(nodes, visibleNodes(nodes, []), {}, true)
    const body = engine.bodies.get("total")!
    engine.moveBranch("total", { x: 80, y: 40 })
    engine.step(16.667)
    expect(body.slosh.x).toBeLessThan(0)
    expect(body.slosh.y).toBeLessThan(0)
    expect(Math.hypot(body.strain.x, body.strain.y)).toBeGreaterThan(0)
    expect(body.x).toBeGreaterThan(0)
    expect(body.x).toBeLessThan(80)
    expect(body.y).toBeGreaterThan(0)
    expect(body.y).toBeLessThan(40)
    let largestRebound = 0
    for (let frame = 0; frame < 90; frame++) {
      engine.step(16.667)
      largestRebound = Math.max(largestRebound, body.slosh.x)
    }
    expect(largestRebound).toBeLessThan(0.1)
    engine.releaseBranch()
    tick(engine)
    expect(Math.hypot(body.slosh.x, body.slosh.y)).toBeLessThan(0.001)
    expect(body.x).toBeCloseTo(80, 6)
  })

  it("bounds liquid motion on rapid direction changes and removes it for reduced motion", () => {
    const engine = new BlobPhysics()
    engine.sync(nodes, nodes, {}, true)
    const body = engine.bodies.get("total")!
    for (let frame = 0; frame < 120; frame++) {
      engine.moveBranch("total", { x: frame % 2 ? 800 : -800, y: frame * 2 })
      engine.step(frame % 2 ? 8.33 : 32)
      expect(Math.hypot(body.slosh.x, body.slosh.y)).toBeLessThanOrEqual(body.node.radius * 0.075 + 1e-8)
    }
    engine.moveBranch("total", { x: 0, y: 0 }, true)
    engine.step(16.667)
    expect(body.slosh).toEqual({ x: 0, y: 0 })
    expect(body.wobble).toBe(0)
  })

  it("does not rotate the outline sideways when drag direction reverses", () => {
    const engine = new BlobPhysics()
    engine.sync(nodes, visibleNodes(nodes, []), {}, true)
    const body = engine.bodies.get("total")!
    for (let frame = 0; frame < 80; frame++) {
      engine.moveBranch("total", { x: frame < 40 ? frame * 20 : (80 - frame) * 20, y: 0 })
      engine.step(16.667)
      expect(body.strain.x).toBeGreaterThanOrEqual(0)
      expect(body.strain.y).toBeCloseTo(0, 8)
      expect(body.strain.x).toBeLessThanOrEqual(0.071)
    }
  })

  it("smooths sparse pointer updates consistently across display refresh rates", () => {
    const simulate = (interval: number) => {
      const engine = new BlobPhysics()
      engine.sync(nodes, visibleNodes(nodes, []), {}, true)
      const body = engine.bodies.get("total")!
      engine.moveBranch("total", { x: 600, y: 200 })
      expect(body.x).toBe(0)
      let previous = 0
      for (let time = 0; time < 200 - 0.001; time += interval) {
        engine.step(interval)
        expect(body.x).toBeGreaterThanOrEqual(previous)
        expect(body.x).toBeLessThanOrEqual(600)
        previous = body.x
      }
      return body.x
    }
    expect(simulate(1000 / 30)).toBeCloseTo(simulate(1000 / 120), 5)
  })
})
