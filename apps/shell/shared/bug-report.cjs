const BUG_REPORT_URL = "https://betterc0de.com/api/bug/report"
const COOLDOWN_MS = 10_000
const { formatBugReportDeviceInfo } = require("./bug-report-device-info.cjs")

/** One sender per main process: the limit applies across all renderer windows. */
function createBugReportSender({ appVersion, os, arch = process.arch, installId = null, getLogs = () => "", getDeviceInfo = async () => null, fetchImpl = fetch, now = Date.now, timeoutMs = 15_000 }) {
  let nextAllowedAt = 0
  let pending = false
  const retryAfterMs = () => Math.max(0, nextAllowedAt - now())

  return async function sendBugReport(input) {
    if (pending || retryAfterMs() > 0) {
      return { ok: false, error: "Please wait before sending another report.", retryAfterMs: retryAfterMs() }
    }
    if (!input || typeof input.message !== "string" || !input.message.trim()
      || input.message.length > 128_000 || typeof input.stack !== "string" || input.stack.length > 32_000
      || (input.logs !== undefined && (typeof input.logs !== "string" || input.logs.length > 64_000))) {
      return { ok: false, error: "Invalid bug report.", retryAfterMs: 0 }
    }

    pending = true
    nextAllowedAt = now() + COOLDOWN_MS
    const controller = new AbortController()
    let timeout
    try {
      // Diagnostics are best effort. A driver/API failure must not prevent the report.
      const deviceInfo = await Promise.resolve().then(getDeviceInfo).catch(() => null)
      const logs = [input.logs, getLogs()].filter(Boolean).join("\n").slice(-64_000)
      const deviceSection = `\n\n${formatBugReportDeviceInfo(deviceInfo)}`
      // Preserve diagnostics even when the console already fills the payload limit.
      const messageLimit = 128_000 - deviceSection.length
      const message = (input.message.length > messageLimit
        ? `${input.message.slice(0, messageLimit - 12)}\n[truncated]`
        : input.message) + deviceSection
      timeout = setTimeout(() => controller.abort(), timeoutMs)
      const response = await fetchImpl(BUG_REPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, stack: input.stack, logs, installId, appVersion, os, arch, deviceInfo }),
        signal: controller.signal,
        redirect: "error",
      })
      // The endpoint need not return JSON (204 is a valid success).
      await response.body?.cancel()
      return response.ok
        ? { ok: true, retryAfterMs: retryAfterMs() }
        : { ok: false, error: `Report could not be sent (HTTP ${response.status}).`, retryAfterMs: retryAfterMs() }
    } catch {
      return {
        ok: false,
        error: controller.signal.aborted
          ? "Sending the report timed out. Please try again."
          : "Report could not be sent. Check your connection and try again.",
        retryAfterMs: retryAfterMs(),
      }
    } finally {
      clearTimeout(timeout)
      pending = false
    }
  }
}

module.exports = { createBugReportSender }
