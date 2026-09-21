import { spawn, type ChildProcess } from "node:child_process"
import { sanitizedChildEnvironment } from "../security/childEnvironment"

/**
 * Shared Windows process-tree termination.
 *
 * Node has no process-group notion on Windows, so every service that owns a
 * child tree (shell, git, workspace formatters, native text generation, image
 * generation, CLI probes) ends up shelling out to `taskkill /T`. Three
 * near-identical copies of that helper drifted apart in timeout handling and
 * in what they did when the helper itself hung. This is the single
 * implementation; callers pick the shape they need:
 *
 *  - {@link runWindowsTaskkillDetailed} reports what happened without
 *    throwing, for callers that assemble a diagnostic trail (git).
 *  - {@link runWindowsTaskkill} throws a coded error on failure, for callers
 *    that treat an unconfirmed tree as a hard failure (shell, formatters).
 *
 * Hard limit worth knowing: `taskkill /T` only works while the ROOT PID is
 * still owned by our ChildProcess. Once the root has exited, Windows may reuse
 * the PID, and its former descendants (a `cmd /c npm run dev` tree, say) can no
 * longer be addressed safely. Killing them would need a Job Object, which is
 * native code this backend does not ship. Callers therefore terminate while
 * the root is alive and, when they cannot, log that descendants may be
 * orphaned rather than pretending the tree is gone.
 */

export type TaskkillSpawn = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: "ignore"
    windowsHide: boolean
    shell: false
  }
) => ChildProcess

export type TaskkillResult =
  | { status: "closed"; code: number | null; signal: NodeJS.Signals | null }
  | { status: "error"; message: string }
  | { status: "timeout" }

export interface TaskkillOptions {
  /** Injectable for tests and for services that route spawns through a seam. */
  readonly spawnProcess?: TaskkillSpawn
  /** Total bound, including the wait for the helper to close after a kill. */
  readonly timeoutMs?: number
}

const DEFAULT_TASKKILL_TIMEOUT_MS = 5_000
/** Upper bound on how long we wait for a killed helper to report `close`. */
const TASKKILL_EXIT_CONFIRM_MAX_MS = 250

/**
 * Run `taskkill /pid <pid> /T [/F]` and report the outcome.
 *
 * The promise settles only on the helper's `close` (or once the post-kill
 * confirmation window elapses). Settling on `error` alone would let the
 * caller proceed while the helper is still running.
 */
export function runWindowsTaskkillDetailed(
  pid: number,
  force: boolean,
  options: TaskkillOptions = {}
): Promise<TaskkillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS
  if (timeoutMs <= 0) return Promise.resolve({ status: "timeout" })
  const spawnProcess = options.spawnProcess ?? (spawn as TaskkillSpawn)

  return new Promise((resolve) => {
    let killer: ChildProcess
    try {
      killer = spawnProcess(
        "taskkill.exe",
        ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])],
        {
          env: sanitizedChildEnvironment(),
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        }
      )
    } catch (error) {
      resolve({ status: "error", message: errorMessage(error) })
      return
    }

    let settled = false
    let timedOut = false
    let spawnError: Error | null = null
    let killTimer: NodeJS.Timeout | null = null
    let exitConfirmationTimer: NodeJS.Timeout | null = null
    const finish = (result: TaskkillResult) => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      if (exitConfirmationTimer) clearTimeout(exitConfirmationTimer)
      killer.removeListener("error", onError)
      killer.removeListener("close", onClose)
      resolve(result)
    }
    const onError = (error: Error) => {
      // Keep waiting for `close`; an `error` (ENOENT, EPERM) is followed by
      // it and the close event remains the decisive signal.
      spawnError = error
    }
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (timedOut) {
        finish({ status: "timeout" })
        return
      }
      if (spawnError) {
        finish({ status: "error", message: spawnError.message })
        return
      }
      finish({ status: "closed", code, signal })
    }
    // Reserve a slice of the budget for the helper to acknowledge SIGKILL, so
    // the total stays within `timeoutMs`.
    const exitConfirmationMs = Math.min(
      TASKKILL_EXIT_CONFIRM_MAX_MS,
      Math.max(1, Math.floor(timeoutMs / 4))
    )
    const killAtMs = Math.max(1, timeoutMs - exitConfirmationMs)
    killTimer = setTimeout(() => {
      timedOut = true
      try {
        killer.kill("SIGKILL")
      } catch {
        // The helper may already be closing; its close event remains decisive.
      }
      exitConfirmationTimer = setTimeout(
        () => finish({ status: "timeout" }),
        exitConfirmationMs
      )
      exitConfirmationTimer.unref?.()
    }, killAtMs)
    killTimer.unref?.()

    killer.once("error", onError)
    killer.once("close", onClose)
  })
}

/**
 * Throwing variant. Rejects with `code: "TASKKILL_TIMEOUT"` when the helper
 * had to be killed, `"TASKKILL_FAILED"` on a non-zero exit, or the spawn error
 * itself when the helper could not start.
 */
export async function runWindowsTaskkill(
  pid: number,
  force: boolean,
  options: TaskkillOptions = {}
): Promise<void> {
  const result = await runWindowsTaskkillDetailed(pid, force, options)
  switch (result.status) {
    case "closed":
      if (result.code === 0) return
      throw Object.assign(
        new Error(
          `taskkill for process tree ${pid} exited with code ${String(
            result.code
          )}${result.signal ? ` (${result.signal})` : ""}.`
        ),
        {
          code: "TASKKILL_FAILED",
          pid,
          exitCode: result.code,
          signal: result.signal,
        }
      )
    case "timeout":
      throw Object.assign(
        new Error(`taskkill for process tree ${pid} timed out.`),
        { code: "TASKKILL_TIMEOUT", pid }
      )
    case "error":
      throw Object.assign(new Error(result.message), {
        code: "TASKKILL_SPAWN_FAILED",
        pid,
      })
  }
}

export function formatTaskkillResult(result: TaskkillResult): string {
  switch (result.status) {
    case "closed":
      return `exited with code ${result.code ?? "unknown"}${
        result.signal ? ` (${result.signal})` : ""
      }`
    case "error":
      return `failed: ${result.message}`
    case "timeout":
      return "timed out"
  }
}

/** `process.kill` reports a vanished process or group as ESRCH. */
export function isNoSuchProcessError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ESRCH"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
