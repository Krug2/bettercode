import { describe, expect, it } from "vitest"
import { resizeWorkspacePanel, restoreWorkspace, workspaceUrl } from "./canvas-workspace"

describe("workspace layout", () => {
  const panel = { id: "a", kind: "browser", title: "Docs", url: "https://example.com", text: "", x: -400, y: 120, width: 900, height: 600 }
  it("restores negative positions, sizes, and the camera", () => {
    expect(restoreWorkspace({ panels: [panel], camera: { zoom: 0.4, pan: { x: 320, y: -50 } } })).toEqual({ panels: [{ ...panel, url: "https://example.com/" }], camera: { zoom: 0.4, pan: { x: 320, y: -50 } } })
  })
  it("discards invalid and duplicate panels without losing valid windows", () => {
    const data = restoreWorkspace({ panels: [null, panel, panel, { ...panel, id: "b", x: NaN }, { ...panel, id: "c", kind: "unknown" }, { ...panel, id: "d", url: "javascript:alert(1)" }], camera: { zoom: Infinity } })
    expect(data.panels.map(p => p.id)).toEqual(["a", "d"])
    expect(data.panels[1].url).toBe("")
    expect(data.camera).toBeNull()
  })
  it("resizes in world coordinates at different zoom levels and enforces usable limits", () => {
    expect(resizeWorkspacePanel(panel, { x: 100, y: 50 }, 0.5)).toMatchObject({ x: -400, y: 120, width: 1100, height: 700 })
    expect(resizeWorkspacePanel(panel, { x: -2000, y: 3000 }, 1)).toMatchObject({ width: 320, height: 1800 })
  })
  it("normalizes websites and local servers but rejects executable URLs", () => {
    expect(workspaceUrl("github.com/Krug2/bettercode")).toBe("https://github.com/Krug2/bettercode")
    expect(workspaceUrl("localhost:3000")).toBe("http://localhost:3000/")
    expect(workspaceUrl("localhost:3000?view=preview")).toBe("http://localhost:3000/?view=preview")
    expect(workspaceUrl("127.0.0.2:8080")).toBe("http://127.0.0.2:8080/")
    expect(workspaceUrl("example.com:8443/docs")).toBe("https://example.com:8443/docs")
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", "https://user:pass@example.com", ""]) expect(workspaceUrl(url)).toBeNull()
  })
})
