import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const entry = path.join(root, "apps", "backend", "dist", "index.js")
const timeoutMs = 20_000
const startupBudgetMs = numericFlag("--startup-budget-ms")
const rssBudgetMb = numericFlag("--rss-budget-mb")
const dataDir = await mkdtemp(path.join(os.tmpdir(), "betterc0de-smoke-"))
const startedAt = performance.now()
let stderr = ""

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: {
    ...process.env,
    BETTERC0DE_HOME: dataDir,
    BETTERC0DE_DATA_DIR: dataDir,
    BETTERC0DE_PROVIDER_SESSION_REAPER: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
// The readiness contract is on stderr; still consume stdout so logs cannot
// fill its pipe and stall startup or shutdown.
child.stdout.resume()

try {
  const ready = await waitForReady(child, timeoutMs, (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_000)
  })
  const response = await fetch(`http://127.0.0.1:${ready.port}/health`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) {
    throw new Error(`health endpoint returned HTTP ${response.status}`)
  }
  const health = await response.json()
  if (health?.status !== "ok") {
    throw new Error(`unexpected health payload: ${JSON.stringify(health)}`)
  }
  const startupMs = Math.round(performance.now() - startedAt)
  const metricsResponse = await fetch(
    `http://127.0.0.1:${ready.port}/api/v1/runtime/metrics`,
    {
      headers: { Authorization: `Bearer ${ready.token}` },
      signal: AbortSignal.timeout(5_000),
    },
  )
  if (!metricsResponse.ok) {
    throw new Error(`metrics endpoint returned HTTP ${metricsResponse.status}`)
  }
  const metrics = await metricsResponse.json()
  const rss = metrics?.memory?.rss
  if (typeof rss !== "number" || !Number.isFinite(rss) || rss <= 0) {
    throw new Error("metrics endpoint returned invalid RSS")
  }
  const rssMb = Math.round((rss / 1024 / 1024) * 10) / 10
  if (startupBudgetMs !== null && startupMs > startupBudgetMs) {
    throw new Error(
      `backend startup ${startupMs}ms exceeded ${startupBudgetMs}ms budget`,
    )
  }
  if (rssBudgetMb !== null && rssMb > rssBudgetMb) {
    throw new Error(`backend RSS ${rssMb}MB exceeded ${rssBudgetMb}MB budget`)
  }
  process.stdout.write(
    `Backend startup smoke passed on port ${ready.port} (${startupMs}ms, ${rssMb}MB RSS).\n`,
  )
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`)
  process.exitCode = 1
} finally {
  await stopChild(child)
  await rm(dataDir, { recursive: true, force: true })
}

function numericFlag(name) {
  const prefix = `${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return value
}

function waitForReady(processHandle, timeout, onStderr) {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`backend did not become ready within ${timeout}ms`))
    }, timeout)

    const onData = (chunk) => {
      const text = chunk.toString("utf8")
      buffer += text
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith("{")) {
          try {
            const message = JSON.parse(line)
            if (
              message?.status === "ready" &&
              Number.isInteger(message.port) &&
              message.port > 0
            ) {
              cleanup()
              resolve(message)
              return
            }
            if (message?.status === "error") {
              cleanup()
              reject(new Error(message.message || "backend startup failed"))
              return
            }
          } catch {
            // Structured application logs may also start with `{`; only the
            // ready/error contract matters to this smoke test.
          }
        }
        // Never copy the ready envelope's bearer into failure diagnostics.
        onStderr(`${line}\n`)
        newline = buffer.indexOf("\n")
      }
      buffer = buffer.slice(-64_000)
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`backend exited before ready (code ${code ?? "null"})`))
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      processHandle.stderr.off("data", onData)
      processHandle.off("exit", onExit)
      processHandle.off("error", onError)
    }

    processHandle.stderr.on("data", onData)
    processHandle.once("exit", onExit)
    processHandle.once("error", onError)
  })
}

async function stopChild(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null)
    return
  processHandle.kill()
  if (!(await waitForExit(processHandle))) {
    processHandle.kill("SIGKILL")
    if (!(await waitForExit(processHandle))) {
      throw new Error("Backend smoke process did not exit after termination")
    }
  }
}

function waitForExit(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer)
      processHandle.off("exit", onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), 5_000)
    processHandle.once("exit", onExit)
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) finish(true)
  })
}
