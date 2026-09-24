import type { CSSProperties } from "react"
import type { UsageModel } from "@betterc0de/schema"
import { formatCost, formatTokens } from "./format"
import { useUsageGraphStore } from "./graph-store"

export function UsageModelTable({ models }: { models: UsageModel[] }) {
  const colors = useUsageGraphStore(state => state.colors)
  return (
    <details className="usage-models">
      <summary>View model breakdown<span>{models.length} {models.length === 1 ? "model" : "models"}</span></summary>
      <div className="usage-table-scroll">
        <table>
          <caption className="sr-only">Recorded usage per model; unreported spend appears as a dash</caption>
          <thead><tr><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Spend</th><th scope="col">Input spend</th><th scope="col">Output spend</th><th scope="col">Responses</th></tr></thead>
          <tbody>{models.map(model => {
            const unknown = model.unreported === model.calls && model.input + model.output === 0
            return <tr key={model.id}>
              <th scope="row"><span className="usage-model-name"><i style={{ "--blob-hue": colors[model.id] ?? 210 } as CSSProperties} />{model.model}</span><small>{model.provider}{model.unreported > 0 ? ` · ${model.unreported} responses with incomplete usage` : ""}</small></th>
              <td title={model.input.toLocaleString()}>{unknown ? "—" : formatTokens(model.input)}</td>
              <td title={model.output.toLocaleString()}>{unknown ? "—" : formatTokens(model.output)}</td>
              <td>{formatCost(model.cost)}</td><td>{formatCost(model.inputCost)}</td><td>{formatCost(model.outputCost)}</td><td>{model.calls.toLocaleString()}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </details>
  )
}
