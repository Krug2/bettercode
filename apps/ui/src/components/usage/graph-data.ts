import type { UsageModel } from "@betterc0de/schema"
import { formatCost, formatTokens } from "./format"
import { amountScale } from "./amount-scale"

export interface Point { x: number; y: number }
export interface BlobNode {
  id: string
  parent: string | null
  model: string | null
  label: string
  value: string
  hint: string
  amount: number | null
  unit: "tokens" | "usd"
  intensity: number | null
  radius: number
  offset: Point
  children: string[]
}

export const ROOT_BLOB = "total"
const polar = (angle: number, radius: number): Point => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })

export function usageNodes(models: UsageModel[]): BlobNode[] {
  const total = models.reduce((sum, model) => sum + model.input + model.output, 0)
  const nodes: Omit<BlobNode, "radius" | "intensity">[] = [{ id: ROOT_BLOB, parent: null, model: null, label: "Total tokens", value: formatTokens(total), hint: "observed", amount: total, unit: "tokens", offset: { x: 0, y: 0 }, children: [] }]
  const ordered = [...models].sort((a, b) => a.id.localeCompare(b.id))
  ordered.forEach((model, index) => {
    const id = `model:${model.id}`
    const angle = -Math.PI * 0.75 + index / ordered.length * Math.PI * 2
    const inputs = `${id}:input`, outputs = `${id}:output`, spend = `${id}:spend`
    const unknown = model.unreported === model.calls && model.input + model.output === 0
    nodes[0].children.push(id)
    nodes.push({ id, parent: ROOT_BLOB, model: model.id, label: model.model, value: unknown ? "—" : formatTokens(model.input + model.output), hint: model.provider, amount: unknown ? null : model.input + model.output, unit: "tokens", offset: polar(angle, Math.max(200, ordered.length * 23)), children: [inputs, outputs, spend] })
    nodes.push(
      { id: inputs, parent: id, model: model.id, label: "Input", value: unknown ? "—" : formatTokens(model.input), hint: unknown ? "not reported" : "tokens", amount: unknown ? null : model.input, unit: "tokens", offset: polar(angle - 0.95, 148), children: [] },
      { id: outputs, parent: id, model: model.id, label: "Output", value: unknown ? "—" : formatTokens(model.output), hint: unknown ? "not reported" : "tokens", amount: unknown ? null : model.output, unit: "tokens", offset: polar(angle + 0.95, 148), children: [] },
      { id: spend, parent: id, model: model.id, label: "Spend", value: formatCost(model.cost), hint: model.cost === null ? "not reported" : "reported USD", amount: model.cost, unit: "usd", offset: polar(angle, 151), children: [`${spend}:input`, `${spend}:output`] },
      { id: `${spend}:input`, parent: spend, model: model.id, label: "Input spend", value: formatCost(model.inputCost), hint: model.inputCost === null ? "not reported" : "reported USD", amount: model.inputCost, unit: "usd", offset: polar(angle - 0.65, 133), children: [] },
      { id: `${spend}:output`, parent: spend, model: model.id, label: "Output spend", value: formatCost(model.outputCost), hint: model.outputCost === null ? "not reported" : "reported USD", amount: model.outputCost, unit: "usd", offset: polar(angle + 0.65, 133), children: [] },
    )
  })
  const scales = {
    tokens: amountScale(nodes.filter(node => node.unit === "tokens").map(node => node.amount)),
    usd: amountScale(nodes.filter(node => node.unit === "usd").map(node => node.amount)),
  }
  return nodes.map(node => ({ ...node, ...scales[node.unit](node.amount) }))
}

export function visibleNodes(nodes: BlobNode[], expanded: readonly string[]): BlobNode[] {
  const open = new Set(expanded), visible = new Set<string>()
  return nodes.filter(node => {
    const show = node.parent === null || (visible.has(node.parent) && open.has(node.parent))
    if (show) visible.add(node.id)
    return show
  })
}

export function descendants(nodes: BlobNode[], id: string): Set<string> {
  const result = new Set([id])
  for (const node of nodes) if (node.parent && result.has(node.parent)) result.add(node.id)
  return result
}
