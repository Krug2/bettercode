"use strict"

/**
 * A backend can be healthy but legitimately spend longer than the ordinary
 * startup budget replaying crash-recovery work. The idle deadline catches a
 * silent or dead child, while heartbeat pulses report event-loop liveness.
 * The hard deadline remains absolute so a live-but-stuck async startup can
 * never continue indefinitely.
 * Before the first pulse, a separate budget covers process creation and
 * synchronous module loading, when the child cannot emit heartbeats yet.
 */
function createBackendStartupWatchdog({
  idleTimeoutMs,
  initialTimeoutMs = idleTimeoutMs,
  hardTimeoutMs,
  onTimeout,
  timerApi = { setTimeout, clearTimeout },
}) {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new TypeError("idleTimeoutMs must be a positive number")
  }
  if (
    !Number.isFinite(hardTimeoutMs) ||
    hardTimeoutMs < idleTimeoutMs
  ) {
    throw new TypeError(
      "hardTimeoutMs must be greater than or equal to idleTimeoutMs",
    )
  }
  if (typeof onTimeout !== "function") {
    throw new TypeError("onTimeout must be a function")
  }
  if (
    !Number.isFinite(initialTimeoutMs) ||
    initialTimeoutMs < idleTimeoutMs ||
    initialTimeoutMs > hardTimeoutMs
  ) {
    throw new TypeError(
      "initialTimeoutMs must be between idleTimeoutMs and hardTimeoutMs",
    )
  }

  let stopped = false
  let idleTimer = null
  let hardTimer = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (idleTimer) timerApi.clearTimeout(idleTimer)
    if (hardTimer) timerApi.clearTimeout(hardTimer)
    idleTimer = null
    hardTimer = null
  }

  const expire = (kind, timeoutMs) => {
    if (stopped) return
    stop()
    onTimeout({ kind, timeoutMs })
  }

  const pulse = () => {
    if (stopped) return false
    if (idleTimer) timerApi.clearTimeout(idleTimer)
    idleTimer = timerApi.setTimeout(
      () => expire("idle", idleTimeoutMs),
      idleTimeoutMs,
    )
    idleTimer.unref?.()
    return true
  }

  hardTimer = timerApi.setTimeout(
    () => expire("hard", hardTimeoutMs),
    hardTimeoutMs,
  )
  hardTimer.unref?.()
  idleTimer = timerApi.setTimeout(
    () => expire("initial", initialTimeoutMs),
    initialTimeoutMs,
  )
  idleTimer.unref?.()

  return Object.freeze({ pulse, stop })
}

module.exports = { createBackendStartupWatchdog }
