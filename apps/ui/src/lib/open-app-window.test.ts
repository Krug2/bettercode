import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { openAppWindow } from "./open-app-window"

const chat = vi.hoisted(() => ({
  activeThreadId: "active" as string | null,
  threads: [] as { id: string; projectPath: string; worktreePath?: string }[],
}))
vi.mock("./chat-store", () => ({ useChatStore: { getState: () => chat } }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

describe("openAppWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.activeThreadId = "active"
    chat.threads = [{ id: "active", projectPath: "C:/repo" }]
  })

  it.each(["editor", "design", "agent"] as const)("opens %s in the active worktree", async mode => {
    chat.threads[0]!.worktreePath = "C:/worktrees/feature"
    const windowOpenWith = vi.fn().mockResolvedValue({ ok: true })
    await openAppWindow(mode, "C:/fallback", { windowOpenWith })
    expect(windowOpenWith).toHaveBeenCalledExactlyOnceWith({ mode, cwd: "C:/worktrees/feature" })
    expect(chat.activeThreadId).toBe("active")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("reads the current thread when invoked, including after switching projects", async () => {
    const windowOpenWith = vi.fn().mockResolvedValue({ ok: true })
    await openAppWindow("editor", undefined, { windowOpenWith })
    chat.activeThreadId = "other"
    chat.threads.push({ id: "other", projectPath: "C:/other" })
    await openAppWindow("design", undefined, { windowOpenWith })
    expect(windowOpenWith.mock.calls).toEqual([
      [{ mode: "editor", cwd: "C:/repo" }],
      [{ mode: "design", cwd: "C:/other" }],
    ])
  })

  it("uses the visible project when no active thread has a workspace", async () => {
    chat.activeThreadId = null
    const windowOpenWith = vi.fn().mockResolvedValue({ ok: true })
    await openAppWindow("editor", "C:/fallback", { windowOpenWith })
    expect(windowOpenWith).toHaveBeenCalledExactlyOnceWith({ mode: "editor", cwd: "C:/fallback" })
  })

  it("opens an empty window without accidentally reusing an inactive thread's project", async () => {
    chat.activeThreadId = null
    const windowOpenWith = vi.fn().mockResolvedValue({ ok: true })
    await openAppWindow("agent", undefined, { windowOpenWith })
    expect(windowOpenWith).toHaveBeenCalledExactlyOnceWith({ mode: "agent" })
  })

  it("surfaces shell validation errors", async () => {
    const windowOpenWith = vi.fn().mockResolvedValue({ ok: false, error: "Folder is unavailable" })
    await openAppWindow("design", undefined, { windowOpenWith })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Folder is unavailable")
  })

  it("handles a rejected IPC request without an unhandled rejection", async () => {
    const windowOpenWith = vi.fn().mockRejectedValue(new Error("IPC closed"))
    await expect(openAppWindow("editor", undefined, { windowOpenWith })).resolves.toBeUndefined()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Could not open a new window")
  })
})
