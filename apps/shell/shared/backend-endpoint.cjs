/**
 * Live handle to the loopback backend the main process started.
 *
 * Provider OAuth and workspace-trust checks need the current port and
 * bearer token. Those values change when the backend restarts, so callers
 * read them through a function the main process installs rather than a
 * copy captured at boot.
 */

let readConnection = () => null

function setBackendConnection(read) {
  if (typeof read !== "function") {
    throw new TypeError("Backend connection reader must be a function")
  }
  readConnection = read
}

function getBackendConnection() {
  const cfg = readConnection()
  const port = cfg?.port
  const token = cfg?.token
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (typeof token !== "string" || token.length === 0) return null
  return { port, token }
}

module.exports = {
  setBackendConnection,
  getBackendConnection,
}
