import { rm } from "node:fs/promises"

const DEVTOOLS_ENDPOINT_PATTERN = /DevTools listening on (ws:\/\/[^\s]+)/g
const RETRYABLE_DIRECTORY_REMOVAL_CODES = new Set([
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ENOTEMPTY",
  "EPERM",
])

export function parseDevToolsWebSocketUrl(diagnostics) {
  const text = String(diagnostics ?? "")
  let endpoint = null
  for (const match of text.matchAll(DEVTOOLS_ENDPOINT_PATTERN)) {
    endpoint = match[1] ?? endpoint
  }
  return endpoint
}

export function selectRendererTarget(targets) {
  if (!Array.isArray(targets)) return null
  const candidates = targets.filter((target) => {
    if (!target || typeof target !== "object") return false
    if (target.type !== "page") return false
    if (typeof target.webSocketDebuggerUrl !== "string") return false
    if (typeof target.url !== "string") return false
    return !/^(?:about:blank|chrome-error:|devtools:)/i.test(target.url)
  })
  return (
    candidates.find((target) => target.title === "BetterC0de") ??
    candidates.find((target) =>
      /(?:^|\/)apps\/ui\/dist\/index\.html(?:$|[?#])/i.test(target.url)
    ) ??
    candidates[0] ??
    null
  )
}

export function validateRendererSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, reason: "renderer snapshot is missing" }
  }
  if (
    /^(?:chrome-error:|about:blank|devtools:)/i.test(String(snapshot.url ?? ""))
  ) {
    return { ok: false, reason: "renderer is displaying a Chromium error page" }
  }
  if (
    snapshot.readyState !== "interactive" &&
    snapshot.readyState !== "complete"
  ) {
    return {
      ok: false,
      reason: `renderer document is not ready (${String(snapshot.readyState)})`,
    }
  }
  if (snapshot.title !== "BetterC0de") {
    return {
      ok: false,
      reason: `unexpected renderer title: ${String(snapshot.title)}`,
    }
  }
  if (
    !Number.isInteger(snapshot.rootChildCount) ||
    snapshot.rootChildCount < 1
  ) {
    return { ok: false, reason: "renderer React root has no mounted children" }
  }
  return { ok: true }
}

export async function removeDirectoryWithRetries(
  directory,
  {
    maxAttempts = 10,
    retryDelayMs = 100,
    remove = (target) => rm(target, { recursive: true, force: true }),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer")
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("retryDelayMs must be a non-negative number")
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await remove(directory)
      return
    } catch (error) {
      const retryable =
        error &&
        typeof error === "object" &&
        RETRYABLE_DIRECTORY_REMOVAL_CODES.has(error.code)
      if (!retryable || attempt === maxAttempts) throw error
      await wait(retryDelayMs * attempt)
    }
  }
}
