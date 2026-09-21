const { formatWithOptions } = require("node:util")
const { createBugReportSender } = require("./bug-report.cjs")

function createAppDiagnostics({ logger = console, automaticReports = true, ...senderOptions }) {
  const lines = []
  const activeReports = new Set()
  const restorers = []
  const attached = new WeakSet()
  const addLog = (level, message) => {
    lines.push(`[${new Date().toISOString()}] [${level}] ${String(message).slice(0, 4000)}`)
    if (lines.length > 200) lines.splice(0, lines.length - 200)
  }
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = logger[level]
    if (typeof original !== "function") continue
    const wrapped = (...args) => {
      try {
        addLog(level, formatWithOptions({ depth: 2, maxArrayLength: 20, maxStringLength: 4000 }, ...args))
      } catch { /* Logging must remain safe even for unusual objects. */ }
      return original.apply(logger, args)
    }
    logger[level] = wrapped
    restorers.push(() => { if (logger[level] === wrapped) logger[level] = original })
  }

  const sender = createBugReportSender({ ...senderOptions, getLogs: () => lines.join("\n").slice(-64_000) })
  const sendReport = (report) => {
    if (report?.automatic === true && !automaticReports) {
      return Promise.resolve({ ok: false, error: "Automatic reports are disabled.", retryAfterMs: 0 })
    }
    const pending = sender(report)
    activeReports.add(pending)
    pending.then(() => activeReports.delete(pending), () => activeReports.delete(pending))
    return pending
  }
  const reportError = async (error) => {
    if (!automaticReports) return
    try {
      const message = error instanceof Error ? error.message : formatWithOptions({ depth: 2 }, error)
      return await sendReport({
        message: (message || "Unknown application error").slice(0, 128_000),
        stack: (error instanceof Error ? error.stack || "" : "").slice(0, 32_000),
      })
    } catch {
      // Reporting must never recurse into the application's global error handlers.
    }
  }

  return {
    sendReport,
    reportError,
    attachRenderer(contents) {
      if (attached.has(contents)) return
      attached.add(contents)
      contents.on("console-message", (details) => {
        if (details.frame && contents.mainFrame && details.frame !== contents.mainFrame) return
        addLog(`renderer:${details.level}`, details.message)
      })
      contents.on("render-process-gone", (_event, details) => {
        if (["clean-exit", "killed"].includes(details.reason)) return
        void reportError(new Error(`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`))
      })
    },
    async flush(timeoutMs = 5000) {
      if (activeReports.size === 0) return
      let timer
      try {
        await Promise.race([
          Promise.allSettled([...activeReports]),
          new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
        ])
      } finally { clearTimeout(timer) }
    },
    dispose() { for (const restore of restorers) restore() },
  }
}

module.exports = { createAppDiagnostics }
