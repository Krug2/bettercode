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
    engine.moveBranch(parent.node.id, { x: parent.x + 200, y: parent.y + 100 })
    expect(child.x).toBe(original.x)
    expect(child.target).toEqual({ x: target.x + 200, y: target.y + 100 })
    const saved = engine.releaseBranch()
    tick(engine)
    const restored = new BlobPhysics()
    restored.sync(nodes, visibleNodes(nodes, open), saved, true)
    expect(restored.bodies.get("model:a")!.target).toEqual(saved["model:a"])
    expect(restored.bodies.get("model:a:input")!.target).toEqual(saved["model:a:input"])
    expect(saved["model:b"]).toBeUndefined()
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

  it("keeps deliberately overlapping saved positions anchored", () => {
    const engine = new BlobPhysics()
    const saved = { "model:a": { x: 100, y: 100 }, "model:b": { x: 130, y: 100 } }
    engine.sync(nodes, visibleNodes(nodes, ["total"]), saved, true)
    tick(engine)
    expect(engine.bodies.get("model:a")!.x).toBeCloseTo(100, 2)
    expect(engine.bodies.get("model:b")!.x).toBeCloseTo(130, 2)
  })
})
