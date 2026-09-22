import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type { BlobNode, Point } from "./graph-data"
import { blobTargets, fitBlobs, graphHeight, separateTargets } from "./graph-layout"
import { useUsageGraphStore } from "./graph-store"

export function useGraphViewport(stage: RefObject<HTMLDivElement | null>, nodes: BlobNode[], visible: BlobNode[], positions: Record<string, Point>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [height, setHeight] = useState(0)
  const previous = useRef({ ids: new Set<string>(), width: 0 })
  const initialCamera = useRef(useUsageGraphStore.getState().camera)

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [stage])

  useLayoutEffect(() => {
    if (!size.width) return
    const first = previous.current.width === 0
    const opening = visible.some(node => !previous.current.ids.has(node.id))
    const resized = Math.abs(previous.current.width - size.width) > 0.5
    previous.current = { ids: new Set(visible.map(node => node.id)), width: size.width }
    if (!opening && !resized) return
    const targets = blobTargets(nodes, positions)
    separateTargets(visible, targets, positions)
    const store = useUsageGraphStore.getState()
    const nextHeight = graphHeight(visible, targets, size.width, Math.max(height, size.height), store.camera.zoom)
    setHeight(nextHeight)
    const saved = initialCamera.current
    if (first && (Object.keys(positions).length || saved.zoom !== 1 || saved.x || saved.y)) return
    store.setCamera(fitBlobs(visible, targets, size.width, nextHeight, store.camera.zoom))
  }, [nodes, visible, positions, size, height])

  return { size, height }
}
