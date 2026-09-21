import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { detectDevServerProject } from "@/lib/dev-server-project"
import { terminalOpen, terminalWrite } from "@/services/backend/workspaceApi"
import { useDevServer } from "./use-dev-server"

const effects = vi.hoisted(() => [] as Array<() => void>)
vi.mock("react", () => ({
  useEffect: (effect: () => void) => effects.push(effect),
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock("@/lib/dev-server-project", () => ({ detectDevServerProject: vi.fn() }))
vi.mock("@/services/backend/workspaceApi", () => ({
  terminalOpen: vi.fn(), terminalWrite: vi.fn(), terminalClose: vi.fn(), terminalRead: vi.fn(),
}))

let projectPath = ""
let projectIndex = 0
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal("window", { addEventListener: vi.fn() })
  effects.splice(0)
  projectPath = `C:/dev-server-test-${++projectIndex}`
  vi.mocked(detectDevServerProject).mockResolvedValue({ scriptName: "dev", packageManager: "npm" })
  vi.mocked(terminalOpen).mockResolvedValue({ sessionId: "test-pty", nextCursor: 0 } as Awaited<ReturnType<typeof terminalOpen>>)
})
afterEach(async () => {
  await useDevServer(projectPath).stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("dev server detection lifecycle", () => {
  it("shares detection and one PTY when multiple canvas consumers mount and start together", async () => {
    const first = useDevServer(projectPath)
    const second = useDevServer(projectPath)
    for (const effect of effects.splice(0)) effect()
    await Promise.all([first.start(), second.start()])

    expect(detectDevServerProject).toHaveBeenCalledExactlyOnceWith(projectPath)
    expect(terminalOpen).toHaveBeenCalledTimes(1)
    expect(terminalWrite).toHaveBeenCalledExactlyOnceWith("test-pty", "npm run dev\r")
    expect(useDevServer(projectPath).status).toBe("starting")
  })

  it("shows detection errors and retries inspection when Retry is pressed", async () => {
    vi.mocked(detectDevServerProject).mockRejectedValueOnce(new Error("Workspace access denied"))
    await useDevServer(projectPath).start()
    expect(useDevServer(projectPath)).toMatchObject({ status: "error", error: "Workspace access denied" })
    expect(terminalOpen).not.toHaveBeenCalled()

    await useDevServer(projectPath).start()
    expect(detectDevServerProject).toHaveBeenCalledTimes(2)
    expect(useDevServer(projectPath)).toMatchObject({ status: "starting", error: null })
    expect(terminalOpen).toHaveBeenCalledTimes(1)
  })

  it("caches successful detection without trying to spawn for a project with no script", async () => {
    vi.mocked(detectDevServerProject).mockResolvedValue({ scriptName: null, packageManager: "npm" })
    await useDevServer(projectPath).start()
    await useDevServer(projectPath).start()
    expect(detectDevServerProject).toHaveBeenCalledTimes(1)
    expect(terminalOpen).not.toHaveBeenCalled()
    expect(useDevServer(projectPath)).toMatchObject({ status: "idle", error: null })
  })
})
