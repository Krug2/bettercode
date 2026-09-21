/**
 * Array-backed JSON persistence adapter for the per-user config files
 * (hooks.json, mcp.json, etc).
 *
 * Each adapter owns a single file containing a JSON array of entities. The
 * upsert / delete / list pattern was duplicated across hooks-ipc.cjs and
 * mcp-ipc.cjs (and adjacent files); centralizing shrinks each module by
 * ~30 LoC and removes the per-file timestamp / id-generation drift.
 *
 * Entities must carry a string `id` (configurable via `idField`).
 *
 * For directory-based persistence (one folder per id, e.g. skills /
 * subagents) this adapter is intentionally NOT used — that pattern has
 * different lifecycle constraints (per-id manifest + content files,
 * directory containment checks) and is handled by the modules themselves.
 */

const crypto = require("crypto")
const fs = require("fs")
const { readJson, writeJson, readBoundedRegularFile } = require("./json-fs.cjs")

/**
 * @typedef {Object} PersistAdapterOptions
 * @property {() => string} filePath        Returns the JSON file path. Called
 *                                          on every read/write so the
 *                                          adapter stays compatible with
 *                                          dynamic runtime paths
 *                                          (`getRuntimePaths()`).
 * @property {string}       [idField]       Default `"id"`.
 * @property {string}       [warnTag]       Tag for `readJson` parse warnings.
 * @property {(input, existing, ctx) => object} [buildEntry]
 *           Build the persisted entry from `(input, existingOrNull, {now, id})`.
 *           Defaults to a shallow merge `{...existing, ...input, id, createdAt, updatedAt}`.
 */

function defaultBuildEntry(input, existing, { now, id }) {
  return {
    ...(existing ?? {}),
    ...input,
    id,
    createdAt: input.createdAt || existing?.createdAt || now,
    updatedAt: now,
  }
}

function createArrayPersistAdapter(opts) {
  const idField = opts.idField || "id"
  const buildEntry = opts.buildEntry || defaultBuildEntry
  const warnTag = opts.warnTag
  const maxItems =
    Number.isInteger(opts.maxItems) && opts.maxItems > 0
      ? opts.maxItems
      : 1_000
  const maxBytes =
    Number.isInteger(opts.maxBytes) && opts.maxBytes > 0
      ? opts.maxBytes
      : undefined

  function validateCollection(items) {
    if (!Array.isArray(items) || items.length > maxItems) {
      throw new Error(`Persisted collection must be an array of at most ${maxItems} entries`)
    }
    const identities = new Set()
    for (const item of items) {
      const id = item && typeof item === "object" && !Array.isArray(item)
        ? item[idField]
        : undefined
      if (typeof id !== "string" || !id.trim() || identities.has(id)) {
        throw new Error("Persisted entity identity must be a nonempty unique string")
      }
      identities.add(id)
    }
    return items
  }

  function read() {
    const items = readJson(opts.filePath(), [], {
      ...(warnTag ? { warn: warnTag } : {}),
      ...(maxBytes ? { maxBytes } : {}),
    })
    return validateCollection(items)
  }
  function write(items) {
    validateCollection(items)
    const filePath = opts.filePath()
    // Reads retain the legacy empty-list fallback. Before a mutation, retain
    // invalid JSON verbatim and refuse to replace files we cannot safely read.
    let previous
    try {
      previous = readBoundedRegularFile(filePath, Math.min(maxBytes || 8 * 1024 * 1024, 8 * 1024 * 1024))
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    if (previous !== undefined) {
      try {
        JSON.parse(previous.toString("utf-8"))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        const backup = `${filePath}.corrupt-${crypto.randomUUID()}`
        const handle = fs.openSync(backup, "wx", 0o600)
        try {
          fs.writeFileSync(handle, previous)
          fs.fsyncSync(handle)
        } finally {
          fs.closeSync(handle)
        }
      }
    }
    writeJson(filePath, items, maxBytes ? { maxBytes } : undefined)
  }
  function list() {
    return read()
  }
  function get(id) {
    return read().find((item) => item[idField] === id) ?? null
  }
  function save(input) {
    const items = read()
    const id = input[idField] || crypto.randomUUID()
    const now = new Date().toISOString()
    const idx = items.findIndex((item) => item[idField] === id)
    const existing = idx >= 0 ? items[idx] : null
    const entry = buildEntry(input, existing, { now, id })
    if (idx >= 0) items[idx] = entry
    else {
      if (items.length >= maxItems) {
        throw new Error(`Refusing to persist more than ${maxItems} entries`)
      }
      items.push(entry)
    }
    write(items)
    return entry
  }
  function update(id, patcher) {
    const items = read()
    const idx = items.findIndex((item) => item[idField] === id)
    if (idx < 0) return null
    const now = new Date().toISOString()
    const next =
      typeof patcher === "function"
        ? patcher(items[idx])
        : { ...items[idx], ...patcher }
    items[idx] = { ...next, [idField]: id, updatedAt: now }
    write(items)
    return items[idx]
  }
  function remove(id) {
    const items = read()
    const next = items.filter((item) => item[idField] !== id)
    if (next.length === items.length) return false
    write(next)
    return true
  }
  function replaceAll(items) {
    write(items)
  }
  return { list, get, save, update, remove, read, replaceAll }
}

module.exports = { createArrayPersistAdapter }
