import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import type { BlobNode, Point } from "./graph-data"
import { blobTargets, fitBlobs, separateTargets } from "./graph-layout"
import { useUsageGraphStore } from "./graph-store"

export function useGraphViewport(stage: RefObject<HTMLDivElement | null>, nodes: BlobNode[], visible: BlobNode[], positions: Record<string, Point>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const previous = useRef({ ids: new Set<string>(), width: 0, height: 0 })
  const initialCamera = useRef(useUsageGraphStore.getState().camera)

  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [stage])

  useLayoutEffect(() => {
    if (!size.width || !size.height) return
    const first = previous.current.width === 0
    const opening = visible.some(node => !previous.current.ids.has(node.id))
    const resized = Math.abs(previous.current.width - size.width) > 0.5 || Math.abs(previous.current.height - size.height) > 0.5
    previous.current = { ids: new Set(visible.map(node => node.id)), ...size }
    if (!opening && !resized) return
    const targets = blobTargets(nodes, positions)
    separateTargets(visible, targets, positions)
    const store = useUsageGraphStore.getState()
    const saved = initialCamera.current
    if (first && (Object.keys(positions).length || saved.zoom !== 1 || saved.x || saved.y)) return
    store.setCamera(fitBlobs(visible, targets, size.width, size.height, store.camera.zoom))
  }, [nodes, visible, positions, size])

  return size
}
