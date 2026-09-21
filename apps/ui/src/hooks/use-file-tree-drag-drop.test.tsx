import { renderToStaticMarkup } from "react-dom/server"
import type { DragEvent } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useFileTreeDragDrop } from "./use-file-tree-drag-drop"
import { FILE_TREE_DRAG_TYPE } from "@/lib/file-tree-move"

class Target {
  dataset: Record<string, string> = {}
  private action: boolean
  constructor(
    path?: string,
    kind = "folder",
    action = false
  ) {
    this.action = action
    if (path !== undefined)
      this.dataset = {
        betterc0deFileTreePath: path,
        betterc0deFileTreeKind: kind,
      }
  }
  closest(selector: string) {
    if (selector.includes("button")) return this.action ? this : null
    if (selector === "input, textarea") return null
    return this.dataset.betterc0deFileTreePath === undefined ? null : this
  }
  getBoundingClientRect() {
    return { top: 100, height: 28 }
  }
  contains() {
    return false
  }
}

function setup(busy = false) {
  const onMove = vi.fn()
  const onExpand = vi.fn()
  let handlers!: ReturnType<typeof useFileTreeDragDrop>["dragHandlers"]
  function Harness() {
    handlers = useFileTreeDragDrop({
      projectPath: "/repo",
      busy,
      onMove,
      onExpand,
    }).dragHandlers
    return null
  }
  renderToStaticMarkup(<Harness />)
  const transfer = {
    types: [FILE_TREE_DRAG_TYPE],
    effectAllowed: "",
    dropEffect: "",
    setData: vi.fn(),
  }
  const event = (target: Target, clientY = 114) =>
    ({
      target,
      clientY,
      currentTarget: new Target(),
      relatedTarget: null,
      dataTransfer: transfer,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as DragEvent<HTMLElement>
  return { handlers, onMove, onExpand, event, transfer }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("Element", Target)
  vi.stubGlobal("Node", Target)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("workspace drag and drop", () => {
  it("moves an internal entry into a folder and clears the hover timer", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("src")))
    const target = t.event(new Target("assets"))
    t.handlers.onDragOver(target)
    expect(target.preventDefault).toHaveBeenCalled()
    expect(t.transfer.dropEffect).toBe("move")
    t.handlers.onDrop(target)
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "src",
      toRelativePath: "assets/src",
    })
    vi.runAllTimers()
    expect(t.onExpand).not.toHaveBeenCalled()
  })

  it("opens a hovered folder once and permits dropping on the workspace root", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    const root = t.event(new Target())
    t.handlers.onDragOver(root)
    t.handlers.onDragOver(root)
    vi.advanceTimersByTime(500)
    expect(t.onExpand).toHaveBeenCalledExactlyOnceWith("")
    t.handlers.onDrop(root)
    expect(t.onMove).toHaveBeenCalledWith({
      fromRelativePath: "assets/src",
      toRelativePath: "src",
    })
  })

  it.each([102, 107, 121, 126])("moves beside a root folder at row coordinate %i", (clientY) => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    const target = t.event(new Target("other"), clientY)
    t.handlers.onDragOver(target)
    expect(target.preventDefault).toHaveBeenCalled()
    vi.runAllTimers()
    expect(t.onExpand).not.toHaveBeenCalled()
    t.handlers.onDrop(target)
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "assets/src",
      toRelativePath: "src",
    })
  })

  it("moves beside a nested folder instead of into it", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    t.handlers.onDrop(t.event(new Target("lib/other"), 102))
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "assets/src",
      toRelativePath: "lib/src",
    })
  })

  it("cancels expansion when moving from a folder's center to its edge", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    const folder = new Target("lib")
    t.handlers.onDragOver(t.event(folder))
    vi.advanceTimersByTime(400)
    t.handlers.onDragOver(t.event(folder, 126))
    vi.runAllTimers()
    expect(t.onExpand).not.toHaveBeenCalled()
    t.handlers.onDrop(t.event(folder, 126))
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "assets/src",
      toRelativePath: "src",
    })
  })

  it("accepts the row action area as a drop target", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("src")))
    t.handlers.onDrop(t.event(new Target("assets", "folder", true)))
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "src",
      toRelativePath: "assets/src",
    })
  })

  it("uses a file's parent and never offers a same-parent move", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    const target = t.event(new Target("assets/other", "folder"), 102)
    t.handlers.onDragOver(target)
    expect(t.transfer.dropEffect).toBe("none")
    expect(target.preventDefault).not.toHaveBeenCalled()
    t.handlers.onDrop(target)
    expect(t.onMove).not.toHaveBeenCalled()
    t.handlers.onDragStart(t.event(new Target("assets/src")))
    t.handlers.onDrop(t.event(new Target("lib/index.ts", "file")))
    expect(t.onMove).toHaveBeenCalledExactlyOnceWith({
      fromRelativePath: "assets/src",
      toRelativePath: "lib/src",
    })
  })

  it("rejects self and descendant drops instead of bubbling them to the root", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("src")))
    const child = t.event(new Target("src/nested"))
    t.handlers.onDragOver(child)
    expect(t.transfer.dropEffect).toBe("none")
    expect(child.preventDefault).not.toHaveBeenCalled()
    t.handlers.onDrop(child)
    expect(child.stopPropagation).toHaveBeenCalled()
    expect(t.onMove).not.toHaveBeenCalled()
  })

  it("ignores external drags even when they spoof the internal MIME type", () => {
    const t = setup()
    const external = t.event(new Target("assets"))
    t.handlers.onDragOver(external)
    t.handlers.onDrop(external)
    expect(external.preventDefault).not.toHaveBeenCalled()
    expect(t.onMove).not.toHaveBeenCalled()
  })

  it("does not start a drag while editing or from a row action", () => {
    const busy = setup(true)
    const event = busy.event(new Target("src"))
    busy.handlers.onDragStart(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(busy.transfer.setData).not.toHaveBeenCalled()
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("src", "folder", true)))
    expect(t.transfer.setData).not.toHaveBeenCalled()
  })

  it("cancels delayed expansion when the drag leaves or ends", () => {
    const t = setup()
    t.handlers.onDragStart(t.event(new Target("src")))
    const target = t.event(new Target("assets"))
    t.handlers.onDragOver(target)
    t.handlers.onDragLeave(target)
    vi.runAllTimers()
    expect(t.onExpand).not.toHaveBeenCalled()
    t.handlers.onDragOver(target)
    t.handlers.onDragEnd()
    vi.runAllTimers()
    expect(t.onExpand).not.toHaveBeenCalled()
    t.handlers.onDrop(target)
    expect(t.onMove).not.toHaveBeenCalled()
  })
})
