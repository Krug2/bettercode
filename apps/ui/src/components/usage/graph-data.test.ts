import { describe, expect, it } from "vitest"
import { descendants, usageNodes, visibleNodes } from "./graph-data"

const models = ["a", "b"].map(id => ({ id, model: id, provider: "local", input: 10, output: 2, calls: 1, unreported: 0, cost: null, inputCost: null, outputCost: null }))

describe("usage branches", () => {
  const nodes = usageNodes(models)
  it("opens every branch simultaneously", () => {
    expect(visibleNodes(nodes, nodes.map(node => node.id))).toHaveLength(13)
    expect(visibleNodes(nodes, ["total", "model:a", "model:b"])).toHaveLength(9)
  })
  it("collapses one branch without collapsing its siblings", () => {
    const visible = visibleNodes(nodes, ["total", "model:b", "model:b:spend"])
    expect(visible.some(node => node.id === "model:a:input")).toBe(false)
    expect(visible.some(node => node.id === "model:b:spend:output")).toBe(true)
  })
  it("finds all downstream blobs without including other models", () => {
    expect(descendants(nodes, "model:a").size).toBe(6)
    expect(descendants(nodes, "model:a").has("model:b")).toBe(false)
  })
  it("scales token amounts separately from costs and excludes missing costs", () => {
    const amounts = usageNodes([{ ...models[0], input: 900, output: 100, cost: 3, inputCost: 2, outputCost: 1 }])
    const find = (id: string) => amounts.find(node => node.id === id)!
    expect(find("model:a:spend").radius).toBe(find("total").radius)
    expect(find("model:a:spend:input").intensity).toBe(0.5)
    expect(find("model:a:input").radius).toBeGreaterThan(find("model:a:output").radius)
    expect(nodes.find(node => node.id === "model:a:spend")!.intensity).toBeNull()
  })
})
