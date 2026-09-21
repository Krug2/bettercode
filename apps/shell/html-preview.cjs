const fs = require("node:fs/promises")
const path = require("node:path")
const { randomUUID } = require("node:crypto")

const HTML_PREVIEW_SCHEME = "betterc0de-html"
const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MIME = new Map(Object.entries({
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".wasm": "application/wasm",
}))

function inside(root, file) {
  const relative = path.relative(root, file)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function publicAsset(relative) {
  // Only browser assets in the chosen project, never dotfiles or dependency stores.
  return relative.split(/[\\/]/).every((part) =>
    part && !part.startsWith(".") && !["node_modules", "vendor"].includes(part.toLowerCase())
  ) && MIME.has(path.extname(relative).toLowerCase())
}

/** Main-owned grants: a renderer cannot turn an arbitrary file URL into a preview. */
function createHtmlPreviewRegistry() {
  const grants = new Map()

  async function open(ownerId, projectPath, selectedPath) {
    if (typeof projectPath !== "string" || !path.isAbsolute(projectPath) ||
        typeof selectedPath !== "string" || !selectedPath || selectedPath.includes("\0")) {
      throw new Error("Choose an HTML file inside this project's folder.")
    }
    const root = await fs.realpath(projectPath)
    if (!(await fs.stat(root)).isDirectory()) throw new Error("Project folder is unavailable.")
    const file = await fs.realpath(path.resolve(root, selectedPath))
    const relativePath = path.relative(root, file).split(path.sep).join("/")
    if (!inside(root, file) || !publicAsset(relativePath) || !/\.html?$/i.test(file)) {
      throw new Error("Choose an .html or .htm file inside this project's folder.")
    }
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) throw new Error("HTML preview files must be smaller than 32 MB.")
    let id = [...grants].find(([, grant]) => grant.ownerId === ownerId && grant.root === root)?.[0]
    if (!id) {
      if ([...grants.values()].filter((grant) => grant.ownerId === ownerId).length >= 64) {
        throw new Error("Too many preview folders open. Reopen this window to start a new session.")
      }
      id = randomUUID()
      grants.set(id, { ownerId, root })
    }
    return { status: "ready", relativePath, url: `${HTML_PREVIEW_SCHEME}://${id}/${relativePath.split("/").map(encodeURIComponent).join("/")}` }
  }

  async function handle(request) {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const grant = grants.get(url.hostname)
      if (url.protocol !== `${HTML_PREVIEW_SCHEME}:` || !grant) return new Response(null, { status: 404 })
      const relative = decodeURIComponent(url.pathname).replace(/^\//, "")
      if (!publicAsset(relative) || relative.includes("\0") || relative.includes(":")) return new Response(null, { status: 403 })
      const candidate = path.resolve(grant.root, relative)
      if (!inside(grant.root, candidate)) return new Response(null, { status: 403 })
      const file = await fs.realpath(candidate)
      if (!inside(grant.root, file) || !publicAsset(path.relative(grant.root, file))) return new Response(null, { status: 403 })
      // Read through the same opened descriptor we stat; cap allocation before reading.
      const descriptor = await fs.open(file, "r")
      try {
        const stat = await descriptor.stat()
        if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return new Response(null, { status: 413 })
        const bytes = Buffer.alloc(stat.size)
        let bytesRead = 0
        while (request.method !== "HEAD" && bytesRead < bytes.length) {
          const chunk = await descriptor.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
          if (!chunk.bytesRead) break
          bytesRead += chunk.bytesRead
        }
        return new Response(request.method === "HEAD" ? null : bytes.subarray(0, bytesRead), {
          headers: {
            "Content-Type": MIME.get(path.extname(file).toLowerCase()),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
          },
        })
      } finally { await descriptor.close() }
    } catch { return new Response(null, { status: 404 }) }
  }

  return { open, handle, revokeOwner(ownerId) {
    for (const [id, grant] of grants) if (grant.ownerId === ownerId) grants.delete(id)
  } }
}

module.exports = { HTML_PREVIEW_SCHEME, createHtmlPreviewRegistry }
