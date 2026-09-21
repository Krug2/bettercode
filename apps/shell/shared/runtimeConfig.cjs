/**
 * Build the inline `window.__BETTERC0DE__` script the main process injects
 * into the trusted renderer after page load.
 *
 * The backend bearer token intentionally never enters this payload. The
 * Electron main process adds it to trusted renderer network requests, so
 * application JavaScript cannot read or exfiltrate it.
 */
function buildRuntimeConfigScript({ port, electronPath, previewPartition }) {
  const payload = {
    port,
    mode: 'local_sidecar',
    electronPath,
    previewPartition,
  }

  return `window.__BETTERC0DE__ = ${JSON.stringify(payload)};`
}

module.exports = {
  buildRuntimeConfigScript,
}
