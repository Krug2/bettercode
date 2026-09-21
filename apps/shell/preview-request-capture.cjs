/**
 * Records every HTTP request a preview guest makes, so the canvas can show a
 * project's live API traffic next to its page. Listens on the preview
 * session's `webRequest` (Electron allows one listener per event per
 * session; nothing else listens on this partition) and forwards one entry
 * per finished request. The guest is not modified: no fetch patching, no
 * injected script, so a page cannot tell it is being observed.
 *
 * Static assets are skipped at the source. A single page load pulls dozens of
 * images and chunks, and none of them is what "which endpoints does this app
 * call" asks about.
 */

const PREVIEW_REQUEST_STATIC_TYPES = new Set([
  "image",
  "font",
  "stylesheet",
  "script",
  "media",
  "cspReport",
])

/** How many in-flight starts to remember before the oldest is dropped. */
const MAX_PENDING_STARTS = 4096

/**
 * Turns a finished `webRequest` details object into the entry the renderer
 * keeps. Exported for tests; `installPreviewRequestCapture` is the wiring.
 */
function previewRequestEntry(details, startedAt, outcome) {
  const finishedAt = typeof details.timestamp === "number" ? details.timestamp : Date.now()
  const began = typeof startedAt === "number" ? startedAt : finishedAt
  return {
    id: String(details.id),
    webContentsId: typeof details.webContentsId === "number" ? details.webContentsId : -1,
    method: typeof details.method === "string" ? details.method : "GET",
    url: typeof details.url === "string" ? details.url : "",
    resourceType: typeof details.resourceType === "string" ? details.resourceType : "other",
    startedAt: began,
    durationMs: Math.max(0, Math.round(finishedAt - began)),
    statusCode: typeof outcome.statusCode === "number" ? outcome.statusCode : null,
    fromCache: Boolean(details.fromCache),
    error: typeof outcome.error === "string" && outcome.error ? outcome.error : null,
  }
}

function installPreviewRequestCapture(previewSession, emit) {
  const starts = new Map()
  const remember = (details) => {
    if (starts.size >= MAX_PENDING_STARTS) {
      const oldest = starts.keys().next().value
      if (oldest !== undefined) starts.delete(oldest)
    }
    starts.set(details.id, details.timestamp)
  }
  const finish = (details, outcome) => {
    if (PREVIEW_REQUEST_STATIC_TYPES.has(details.resourceType)) return
    const startedAt = starts.get(details.id)
    starts.delete(details.id)
    emit(previewRequestEntry(details, startedAt, outcome))
  }
  // onSendHeaders is the earliest non-blocking hook, so timing costs the
  // page nothing.
  previewSession.webRequest.onSendHeaders((details) => {
    if (!PREVIEW_REQUEST_STATIC_TYPES.has(details.resourceType)) remember(details)
  })
  previewSession.webRequest.onCompleted((details) => {
    finish(details, { statusCode: details.statusCode, error: null })
  })
  previewSession.webRequest.onErrorOccurred((details) => {
    finish(details, { statusCode: null, error: details.error || "request failed" })
  })
}

module.exports = {
  PREVIEW_REQUEST_STATIC_TYPES,
  installPreviewRequestCapture,
  previewRequestEntry,
}
