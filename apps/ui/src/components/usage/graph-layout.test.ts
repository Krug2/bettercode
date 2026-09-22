import { describe, expect, it } from "vitest"
import { usageNodes, visibleNodes } from "./graph-data"
import { blobTargets, fitBlobs, graphHeight, separateTargets } from "./graph-layout"

const models = ["a", "b", "c", "d"].map(id => ({ id, model: id, provider: "local", input: 10, output: 2, calls: 1, unreported: 0, cost: 3, inputCost: 1, outputCost: 2 }))
const nodes = usageNodes(models)

describe("graph viewport", () => {
  it("grows to fit expanded branches and retains its height when they close", () => {
    const targets = blobTargets(nodes, {})
    separateTargets(nodes, targets, {})
    const expanded = graphHeight(nodes, targets, 1100, 360, 1)
    expect(expanded).toBeGreaterThan(360)
    expect(expanded).toBeLessThanOrEqual(960)
    expect(graphHeight(visibleNodes(nodes, []), targets, 1100, expanded, 1)).toBe(expanded)
  })

  it("fits new content without increasing an existing zoom", () => {
    const targets = blobTargets(nodes, {})
    separateTargets(nodes, targets, {})
    for (const previousZoom of [0.25, 0.6, 1, 2]) {
      const height = graphHeight(nodes, targets, 900, 420, previousZoom)
      const camera = fitBlobs(nodes, targets, 900, height, previousZoom)
      expect(camera.zoom).toBeLessThanOrEqual(previousZoom)
      expect(Number.isFinite(camera.x + camera.y + camera.zoom)).toBe(true)
    }
  })
})
