import { useCallback, useEffect, useSyncExternalStore } from "react"
import {
  terminalClose,
  terminalOpen,
  terminalRead,
  terminalWrite,
} from "@/services/backend/workspaceApi"
import { detectDevServerProject, type PackageManager } from "@/lib/dev-server-project"
export type { PackageManager } from "@/lib/dev-server-project"

/**
 * Dev-server lifecycle for the design-mode preview, built on the backend's
 * persistent PTY API (/shell/pty/*).
 *
 * A module-level registry keyed by projectPath owns the PTY session and its
 * polling loop, so the server survives unmount/mode-switches and two mounted
 * consumers never double-spawn. Unmounting only unsubscribes; the session
 * keeps running until Stop, window unload, or backend exit (PTYs are children
 * of the backend process — the hard leak bound).
 */

export type DevServerStatus =
  | "idle"
  | "detecting"
  | "starting"
  | "running"
  | "error"
  | "stopped"

export interface DevServerState {
  status: DevServerStatus
  /** Served URL once detected/probed (host normalized to localhost). */
  url: string | null
  /** package.json script that will be / was launched (dev|start|serve). */
  scriptName: string | null
  packageManager: PackageManager
  /** ANSI-stripped output ring buffer (last {@link MAX_LOG_LINES} lines). */
  logs: string[]
  exitCode: number | null
  error: string | null
  /** True when the running server is our PTY session (Stop is possible). */
  managed: boolean
  /** Still `starting` past the watchdog window — surface a hint. */
  slowStart: boolean
}

const MAX_LOG_LINES = 400
const SLIDING_WINDOW_CHARS = 4096
const POLL_MS_STARTING = 300
const POLL_MS_RUNNING = 1500
const SLOW_START_MS = 120_000
const CONFIRM_TIMEOUT_MS = 3000
/**
 * After this many failed reachability probes for a printed URL we trust the
 * regex match anyway — covers renderers whose CSP blocks fetch to arbitrary
 * localhost ports while the server is in fact up.
 */
const MAX_FAILED_CONFIRMS = 5

const IDLE_STATE: DevServerState = {
  status: "idle",
  url: null,
  scriptName: null,
  packageManager: "npm",
  logs: [],
  exitCode: null,
  error: null,
  managed: false,
  slowStart: false,
}

interface RegistryEntry {
  state: DevServerState
  sessionId: string | null
  cursor: number
  timer: ReturnType<typeof setTimeout> | null
  listeners: Set<() => void>
  /** Rolling tail of recent output so URLs split across PTY chunks match. */
  slidingWindow: string
  startedAt: number | null
  candidateUrl: string | null
  failedConfirms: number
  detected: boolean
  detection: Promise<void> | null
}

const registry = new Map<string, RegistryEntry>()

function getEntry(projectPath: string): RegistryEntry {
  let entry = registry.get(projectPath)
  if (!entry) {
    entry = {
      state: IDLE_STATE,
      sessionId: null,
      cursor: 0,
      timer: null,
      listeners: new Set(),
      slidingWindow: "",
      startedAt: null,
      candidateUrl: null,
      failedConfirms: 0,
      detected: false,
      detection: null,
    }
    registry.set(projectPath, entry)
  }
  return entry
}

function patchState(projectPath: string, patch: Partial<DevServerState>) {
  const entry = getEntry(projectPath)
  entry.state = { ...entry.state, ...patch }
  for (const listener of entry.listeners) listener()
}

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, "").replace(ANSI_OSC, "")
}

const URL_PATTERN =
  /(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{2,5})?(\/[^\s"'<>`]*)?/i

function extractUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text)
  if (!match) return null
  const [, protocol, , port, path] = match
  // 0.0.0.0 / 127.0.0.1 are bind addresses — browse via localhost.
  return `${protocol.toLowerCase()}://localhost${port ?? ""}${path && path !== "/" ? path : ""}`
}

async function isReachable(url: string): Promise<boolean> {
  try {
    // no-cors: an opaque response still proves something is listening.
    await fetch(url, {
      mode: "no-cors",
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
    })
    return true
  } catch {
    return false
  }
}

function appendLogs(entry: RegistryEntry, text: string): string[] {
  const clean = stripAnsi(text)
  entry.slidingWindow = (entry.slidingWindow + clean).slice(
    -SLIDING_WINDOW_CHARS
  )
  const incoming = clean.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (incoming.length === 0) return entry.state.logs
  return [...entry.state.logs, ...incoming].slice(-MAX_LOG_LINES)
}

function stopPolling(entry: RegistryEntry) {
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
}

function schedulePoll(projectPath: string, delay: number) {
  const entry = getEntry(projectPath)
  stopPolling(entry)
  entry.timer = setTimeout(() => {
    void poll(projectPath)
  }, delay)
}

async function poll(projectPath: string) {
  const entry = getEntry(projectPath)
  const sessionId = entry.sessionId
  if (!sessionId) return

  let snapshot
  try {
    snapshot = await terminalRead(sessionId, entry.cursor)
  } catch {
    // 404 → the backend GC'd the session (or backend restarted).
    entry.sessionId = null
    stopPolling(entry)
    patchState(projectPath, {
      status: "stopped",
      managed: false,
      error: null,
    })
    return
  }

  entry.cursor = snapshot.nextCursor
  let logs = entry.state.logs
  let exited: { code: number | null } | null = null
  for (const event of snapshot.events) {
    if (event.type === "data" && event.data) {
      logs = appendLogs(entry, event.data)
    } else if (event.type === "exit") {
      exited = { code: event.exitCode ?? null }
    }
  }
  if (logs !== entry.state.logs) patchState(projectPath, { logs })

  if (exited || snapshot.status === "exited") {
    entry.sessionId = null
    stopPolling(entry)
    const code = exited?.code ?? null
    patchState(projectPath, {
      status: code === 0 || code === null ? "stopped" : "error",
      exitCode: code,
      managed: false,
      error:
        code !== null && code !== 0 ? `Dev server exited with code ${code}` : null,
    })
    return
  }

  if (entry.state.status === "starting") {
    const candidate = extractUrl(entry.slidingWindow)
    if (candidate) {
      if (candidate !== entry.candidateUrl) {
        entry.candidateUrl = candidate
        entry.failedConfirms = 0
      }
      const reachable = await isReachable(candidate)
      if (reachable || ++entry.failedConfirms >= MAX_FAILED_CONFIRMS) {
        patchState(projectPath, {
          status: "running",
          url: candidate,
          slowStart: false,
        })
      }
    } else if (
      entry.startedAt &&
      Date.now() - entry.startedAt > SLOW_START_MS &&
      !entry.state.slowStart
    ) {
      patchState(projectPath, { slowStart: true })
    }
  }

  // Keep polling while anyone is subscribed (log tail + crash detection).
  if (entry.listeners.size > 0) {
    schedulePoll(
      projectPath,
      entry.state.status === "running" ? POLL_MS_RUNNING : POLL_MS_STARTING
    )
  } else {
    stopPolling(entry)
  }
}

function detect(projectPath: string): Promise<void> {
  const entry = getEntry(projectPath)
  if (entry.detected) return Promise.resolve()
  if (entry.detection) return entry.detection
  entry.detection = Promise.resolve().then(async () => {
    if (entry.state.status !== "running" && entry.state.status !== "starting") {
      patchState(projectPath, { status: "detecting", error: null })
    }
    try {
      const project = await detectDevServerProject(projectPath)
      entry.detected = true
      patchState(projectPath, {
        ...project,
        status: entry.state.status === "detecting" ? "idle" : entry.state.status,
      })
    } catch (error) {
      if (entry.state.status === "detecting") {
        patchState(projectPath, {
          status: "error",
          scriptName: null,
          error: error instanceof Error ? error.message : "Failed to inspect the project.",
        })
      }
    }
  }).finally(() => {
    entry.detection = null
  })
  return entry.detection
}

async function start(projectPath: string) {
  const entry = getEntry(projectPath)
  await detect(projectPath)
  if (
    (entry.state.status === "starting" || entry.state.status === "running")
  ) {
    return
  }
  const { scriptName, packageManager } = entry.state
  if (!scriptName) return

  entry.slidingWindow = ""
  entry.candidateUrl = null
  entry.failedConfirms = 0
  entry.startedAt = Date.now()
  patchState(projectPath, {
    status: "starting",
    logs: [],
    exitCode: null,
    error: null,
    url: null,
    managed: true,
    slowStart: false,
  })

  try {
    // Open the platform default shell and type the command into it instead of
    // direct-spawning the package manager — on Windows `pnpm`/`npm` are .cmd
    // shims that a direct PTY spawn can miss; the user's shell resolves them
    // exactly like a hand-typed command.
    const snapshot = await terminalOpen({
      cwd: projectPath,
      cols: 120,
      rows: 30,
    })
    entry.sessionId = snapshot.sessionId
    entry.cursor = snapshot.nextCursor
    await terminalWrite(
      snapshot.sessionId,
      `${packageManager} run ${scriptName}\r`
    )
    registerUnloadCleanup()
    schedulePoll(projectPath, POLL_MS_STARTING)
  } catch (err) {
    entry.sessionId = null
    patchState(projectPath, {
      status: "error",
      managed: false,
      error:
        err instanceof Error ? err.message : "Failed to start the dev server",
    })
  }
}

async function stop(projectPath: string) {
  const entry = getEntry(projectPath)
  stopPolling(entry)
  const sessionId = entry.sessionId
  entry.sessionId = null
  if (sessionId) {
    try {
      await terminalClose(sessionId)
    } catch {
      /* already gone */
    }
  }
  patchState(projectPath, {
    status: "stopped",
    managed: false,
    slowStart: false,
  })
}

async function restart(projectPath: string) {
  await stop(projectPath)
  await start(projectPath)
}

/**
 * One-shot reachability probe for an externally started server (the user ran
 * `npm run dev` in their own terminal). Flips idle→running (unmanaged) so the
 * preview auto-connects with zero clicks.
 */
async function probe(projectPath: string, url: string) {
  const entry = getEntry(projectPath)
  if (entry.state.status !== "idle" && entry.state.status !== "stopped") return
  if (await isReachable(url)) {
    // Re-check: start() may have raced us while the fetch was in flight.
    const current = getEntry(projectPath).state.status
    if (current === "idle" || current === "stopped") {
      patchState(projectPath, { status: "running", url, managed: false })
    }
  }
}

let unloadCleanupRegistered = false
function registerUnloadCleanup() {
  if (unloadCleanupRegistered) return
  unloadCleanupRegistered = true
  window.addEventListener("beforeunload", () => {
    for (const entry of registry.values()) {
      if (entry.sessionId) void terminalClose(entry.sessionId)
    }
  })
}

function subscribeEntry(projectPath: string, listener: () => void) {
  const entry = getEntry(projectPath)
  entry.listeners.add(listener)
  // Resume the polling loop for a still-running managed session that was
  // paused when the last consumer unmounted.
  if (entry.sessionId && !entry.timer) {
    schedulePoll(
      projectPath,
      entry.state.status === "running" ? POLL_MS_RUNNING : POLL_MS_STARTING
    )
  }
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) stopPolling(entry)
  }
}

export interface UseDevServerResult extends DevServerState {
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  /** Probe a URL for an externally started server (idle/stopped only). */
  probe: (url: string) => Promise<void>
}

export function useDevServer(projectPath: string | null): UseDevServerResult {
  const subscribe = useCallback(
    (listener: () => void) =>
      projectPath ? subscribeEntry(projectPath, listener) : () => {},
    [projectPath]
  )
  const state = useSyncExternalStore(subscribe, () =>
    projectPath ? getEntry(projectPath).state : IDLE_STATE
  )

  useEffect(() => {
    if (projectPath) void detect(projectPath)
  }, [projectPath])

  return {
    ...state,
    start: useCallback(
      () => (projectPath ? start(projectPath) : Promise.resolve()),
      [projectPath]
    ),
    stop: useCallback(
      () => (projectPath ? stop(projectPath) : Promise.resolve()),
      [projectPath]
    ),
    restart: useCallback(
      () => (projectPath ? restart(projectPath) : Promise.resolve()),
      [projectPath]
    ),
    probe: useCallback(
      (url: string) =>
        projectPath ? probe(projectPath, url) : Promise.resolve(),
      [projectPath]
    ),
  }
}
