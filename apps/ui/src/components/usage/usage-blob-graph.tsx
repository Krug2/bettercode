import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { ExpandIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import type { UsageModel } from "@betterc0de/schema"
import { Button } from "@/components/ui/button"
import { usageNodes, visibleNodes } from "./graph-data"
import { blobTargets, fitBlobs, separateTargets } from "./graph-layout"
import { useUsageGraphStore } from "./graph-store"
import { useBlobScene } from "./use-blob-scene"
import { useBlobInput } from "./use-blob-input"
import "./usage-graph.css"

export function UsageBlobGraph({ models }: { models: UsageModel[] }) {
  const store = useUsageGraphStore()
  const { colorize, positions, setCamera } = store
  const nodes = useMemo(() => usageNodes(models), [models])
  const visible = useMemo(() => visibleNodes(nodes, store.expanded), [nodes, store.expanded])
  const stage = useRef<HTMLDivElement>(null)
  const autoFit = useRef(Object.keys(store.positions).length === 0 && store.camera.zoom === 1)
  const [size, setSize] = useState({ width: 800, height: 520 })
  const scene = useBlobScene(nodes, visible, store.positions, store.camera)
  const { onKeyDown, ...pointerEvents } = useBlobInput(scene, () => { autoFit.current = false })

  useEffect(() => { colorize(models.map(model => model.id)) }, [models, colorize])
  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  const fit = () => {
    const targets = blobTargets(nodes, store.positions)
    separateTargets(visible, targets, store.positions)
    store.setCamera(fitBlobs(visible, targets, size.width, size.height))
  }

  useLayoutEffect(() => {
    if (!autoFit.current) return
    const targets = blobTargets(nodes, positions)
    separateTargets(visible, targets, positions)
    setCamera(fitBlobs(visible, targets, size.width, size.height))
  }, [nodes, visible, positions, setCamera, size])

  const zoom = (factor: number) => {
    autoFit.current = false
    const camera = store.camera, next = Math.max(0.25, Math.min(2, camera.zoom * factor))
    store.setCamera({ x: camera.x * next / camera.zoom, y: camera.y * next / camera.zoom, zoom: next })
  }
  const hue = (model: string | null) => model === null ? undefined : { "--blob-hue": store.colors[model] ?? 210 } as CSSProperties

  return (
    <section className="usage-explorer" aria-labelledby="usage-explorer-title">
      <div className="usage-section-heading">
        <div>
          <h2 id="usage-explorer-title">Token explorer</h2>
          <p>Open a blob to explore its usage. Drag it to move the whole branch.</p>
        </div>
        <div className="usage-actions">
          <Button variant="outline" size="sm" onClick={() => { autoFit.current = true; store.expand(nodes.filter(node => node.children.length).map(node => node.id)) }} disabled={!models.length}>Open all</Button>
          <Button variant="ghost" size="sm" onClick={() => { autoFit.current = true; store.expand([]) }}>Collapse all</Button>
        </div>
      </div>
      <div className="usage-graph-stage" ref={stage} {...pointerEvents} aria-label="Interactive token usage graph">
        <div className="usage-graph-world" ref={scene.world} style={{ "--usage-zoom": store.camera.zoom } as CSSProperties}>
          <svg className="usage-graph-links" width="1" height="1" aria-hidden="true">
            {nodes.filter(node => node.parent).map(node => (
              <path key={node.id} style={hue(node.model)} ref={element => { if (element) scene.links.current.set(node.id, element); else scene.links.current.delete(node.id) }} />
            ))}
          </svg>
          {nodes.map(node => (
            <button
              key={node.id}
              type="button"
              className={`usage-blob${node.parent ? "" : " usage-blob-root"}${node.radius < 48 ? " usage-blob-compact" : ""}`}
              data-blob={node.id}
              hidden
              style={{ ...hue(node.model), "--blob-radius": `${node.radius}px`, width: node.radius * 2, height: node.radius * 2 } as CSSProperties}
              ref={element => { if (element) scene.buttons.current.set(node.id, element); else scene.buttons.current.delete(node.id) }}
              aria-label={`${node.label}: ${node.value}, ${node.hint}`}
              aria-expanded={node.children.length ? store.expanded.includes(node.id) : undefined}
              title={`${node.label} · ${node.value} ${node.hint}`}
              onKeyDown={event => onKeyDown(event, node.id)}
              onClick={() => {
                if (node.children.length) store.toggle(node.id)
                else {
                  const body = scene.physics.bodies.get(node.id)
                  if (body && !scene.reducedMotion) { body.wobbleVelocity = 0.08; scene.wake() }
                }
              }}
            >
              <svg viewBox={`${-node.radius} ${-node.radius} ${node.radius * 2} ${node.radius * 2}`} aria-hidden="true">
                <path ref={element => { if (element) scene.shapes.current.set(node.id, element); else scene.shapes.current.delete(node.id) }} />
              </svg>
              <span className="usage-blob-label">{node.label}</span>
              <strong>{node.value}</strong>
              <span className="usage-blob-hint">{node.hint}</span>
              {node.children.length > 0 && <span className="usage-blob-toggle" aria-hidden="true">{store.expanded.includes(node.id) ? "−" : "+"}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="usage-graph-footer">
        <p>{models.length} {models.length === 1 ? "model" : "models"} · Drag empty space to pan. Arrow keys move a focused blob.</p>
        <div className="usage-actions">
          <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}><MinusIcon className="size-4" /></Button>
          <span className="usage-zoom">{Math.round(store.camera.zoom * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoom(1.25)}><PlusIcon className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Fit all visible blobs" onClick={fit}><ExpandIcon className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Reset blob positions" onClick={() => { autoFit.current = true; store.reset() }}><RotateCcwIcon className="size-4" /></Button>
        </div>
      </div>
    </section>
  )
}
