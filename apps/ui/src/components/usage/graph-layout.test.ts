import { describe, expect, it } from "vitest"
import { usageNodes } from "./graph-data"
import { blobTargets, fitBlobs, separateTargets } from "./graph-layout"

const models = ["a", "b", "c", "d"].map(id => ({ id, model: id, provider: "local", input: 10, output: 2, calls: 1, unreported: 0, cost: 3, inputCost: 1, outputCost: 2 }))
const nodes = usageNodes(models)

describe("graph viewport", () => {
  it("fits expanded branches inside a fixed viewport", () => {
    const targets = blobTargets(nodes, {})
    separateTargets(nodes, targets, {})
    const camera = fitBlobs(nodes, targets, 900, 420)
    for (const node of nodes) {
      const target = targets.get(node.id)!
      const radius = node.radius * camera.zoom
      expect(Math.abs(target.x * camera.zoom + camera.x) + radius).toBeLessThan(450)
      expect(Math.abs(target.y * camera.zoom + camera.y) + radius).toBeLessThan(210)
    }
  })

  it("fits new content without increasing an existing zoom", () => {
    const targets = blobTargets(nodes, {})
    separateTargets(nodes, targets, {})
    for (const previousZoom of [0.25, 0.6, 1, 2]) {
      const camera = fitBlobs(nodes, targets, 900, 420, previousZoom)
      expect(camera.zoom).toBeLessThanOrEqual(previousZoom)
      expect(Number.isFinite(camera.x + camera.y + camera.zoom)).toBe(true)
    }
  })
})
