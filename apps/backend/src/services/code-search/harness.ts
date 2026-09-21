import http, { type IncomingMessage, type ServerResponse } from "node:http"
import fs from "node:fs/promises"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import {
  CODE_SEARCH_SERVER, fileMapInput, fileMapOutput, searchCodeInput, searchCodeOutput,
  type CodeSearchServerResolver,
} from "./contracts"
import { collectWorkspaceData, SEARCH_SCOPE } from "./retrieval"
import { emptyRankingUsage, JevRankingError, rankWithJev } from "./jev-client"
import { SEARCH_LIMITS } from "./limits"

interface HarnessSettings {
  readonly jev_search_enabled: boolean
  readonly jev_api_key?: string | null
}

/** Owned by backend bootstrap. No global listener, index, credentials or workspace. */
export class CodeSearchHarness {
  private listener: http.Server | null = null
  private starting: Promise<string> | null = null
  private closed = false
  private signingKey = randomBytes(32)
  private readonly requests = new Set<AbortController>()
  private readonly pending = new Set<Promise<void>>()
  private activeTools = 0
  private lastSettings: HarnessSettings

  constructor(private readonly options: {
    readonly settings: () => HarnessSettings
    readonly isWorkspaceAllowed: (root: string) => boolean
    readonly fetchImpl?: typeof fetch
  }) {
    this.lastSettings = { ...options.settings() }
  }

  /** Call synchronously on settings changes so disable/key rotation aborts active calls. */
  settingsChanged(): void {
    const next = this.options.settings()
    if (next.jev_search_enabled !== this.lastSettings.jev_search_enabled || next.jev_api_key !== this.lastSettings.jev_api_key) {
      this.signingKey = randomBytes(32)
      for (const request of this.requests) request.abort()
    }
    this.lastSettings = { ...next }
  }

  readonly resolveServer: CodeSearchServerResolver = async (cwd) => {
    this.settingsChanged()
    if (!this.enabled()) return null
    const root = await fs.realpath(cwd)
    if (!this.options.isWorkspaceAllowed(root)) return null
    const url = await this.ensureListening()
    if (!this.enabled()) return null
    const payload = Buffer.from(root).toString("base64url")
    const signature = createHmac("sha256", this.signingKey).update(payload).digest("base64url")
    return { type: "http", url, headers: { Authorization: `Bearer ${payload}.${signature}` } }
  }

  async close(): Promise<void> {
    this.closed = true
    this.signingKey = randomBytes(32)
    for (const request of this.requests) request.abort()
    await this.starting?.catch(() => undefined)
    const server = this.listener
    if (!server) return
    this.listener = null
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await Promise.allSettled([...this.pending])
  }

  private enabled(): boolean {
    const settings = this.options.settings()
    return !this.closed && settings.jev_search_enabled && Boolean(settings.jev_api_key?.trim())
  }

  private ensureListening(): Promise<string> {
    this.starting ??= new Promise<string>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const pending = this.handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500)
          response.end()
        }).finally(() => this.pending.delete(pending))
        this.pending.add(pending)
      })
      server.requestTimeout = SEARCH_LIMITS.mcpMs
      server.headersTimeout = 10_000
      server.maxHeadersCount = 32
      server.on("error", reject)
      server.listen(0, "127.0.0.1", () => {
        this.listener = server
        const address = server.address()
        if (!address || typeof address === "string") { reject(new Error("Code search listener failed.")); return }
        resolve(`http://127.0.0.1:${address.port}/mcp`)
      })
    }).catch((error: unknown) => { this.starting = null; throw error })
    return this.starting
  }

  private authenticate(request: IncomingMessage): string | null {
    const value = request.headers.authorization
    if (!value?.startsWith("Bearer ") || value.length > 8192) return null
    const [payload, signature, extra] = value.slice(7).split(".")
    if (!payload || !signature || extra !== undefined) return null
    const expected = createHmac("sha256", this.signingKey).update(payload).digest()
    const supplied = Buffer.from(signature, "base64url")
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
    return Buffer.from(payload, "base64url").toString("utf8")
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.settingsChanged()
    const port = this.listener?.address()
    if (!port || typeof port === "string" || request.headers.host !== `127.0.0.1:${port.port}` || request.headers.origin || request.url !== "/mcp") {
      response.writeHead(403).end(); return
    }
    if (!this.enabled()) { response.writeHead(403).end(); return }
    const root = this.authenticate(request)
    if (!root || !this.options.isWorkspaceAllowed(root)) { response.writeHead(401).end(); return }
    if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }).end(); return }
    if (!request.headers["content-type"]?.includes("application/json")) { response.writeHead(415).end(); return }
    if (this.requests.size >= 8) { response.writeHead(503).end(); return }
    const controller = new AbortController()
    this.requests.add(controller)
    const abort = () => controller.abort()
    request.once("aborted", abort)
    response.once("close", abort)
    const timer = setTimeout(() => { controller.abort(); response.destroy() }, SEARCH_LIMITS.mcpMs)
    const server = this.createMcpServer(root, controller.signal)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        controller.signal.throwIfAborted()
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > 16 * 1024) { response.writeHead(413).end(); return }
        chunks.push(bytes)
      }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { response.writeHead(400).end(); return }
      if (Array.isArray(body)) { response.writeHead(400).end(); return }
      controller.signal.throwIfAborted()
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
    } finally {
      clearTimeout(timer)
      controller.abort()
      this.requests.delete(controller)
      request.off("aborted", abort)
      response.off("close", abort)
      await server.close()
    }
  }

  private createMcpServer(root: string, signal: AbortSignal): McpServer {
    const server = new McpServer({ name: CODE_SEARCH_SERVER, version: "1.0.0" })
    const run = async (operation: () => Promise<Record<string, unknown>>) => {
      if (this.activeTools >= 2) return { isError: true, content: [{ type: "text" as const, text: "Code search is busy. Retry after the current searches finish." }] }
      this.activeTools++
      try {
        signal.throwIfAborted()
        if (!this.enabled() || !this.options.isWorkspaceAllowed(root) || await fs.realpath(root) !== root) throw new Error("unavailable")
        const result = await operation()
        signal.throwIfAborted()
        if (!this.enabled() || !this.options.isWorkspaceAllowed(root) || await fs.realpath(root) !== root) throw new Error("unavailable")
        return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] }
      } catch {
        return { isError: true, content: [{ type: "text" as const, text: "Code search unavailable or cancelled. Check the integration setting and workspace trust, then retry." }] }
      } finally { this.activeTools-- }
    }
    server.registerTool("file_map", {
      description: "List source/config/document paths in the current workspace. Local only, read-only. Paginated, bounded disk snapshot; inspect coverage for omissions. Use prefix to narrow paths. Does not provide symbols or dependencies.",
      inputSchema: fileMapInput,
      outputSchema: fileMapOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (args) => run(async () => {
      const started = performance.now()
      const result = await collectWorkspaceData({ root, signal, pathPrefixes: [args.prefix] })
      const files = result.files
      const end = args.offset + args.limit
      return fileMapOutput.parse({ files: files.slice(args.offset, end), nextOffset: end < files.length ? end : null, coverage: result.coverage, durationMs: performance.now() - started, scope: SEARCH_SCOPE })
    }))
    server.registerTool("search_code", {
      description: `Find code using literal keywords and paths, then Jev relevance ranking. Sends the query, paths and up to ${SEARCH_LIMITS.candidates} unique code excerpts to TypeSafe AI in bounded batches. Read-only. Supply keywords for identifiers and paths to narrow traversal; semantic recall is limited to lexical candidates. Returns exact disk paths/lines, hashes, coverage, timings, reported token usage and explicit local fallback on ranking failure.`,
      inputSchema: searchCodeInput,
      outputSchema: searchCodeOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, (args) => run(async () => {
      const started = performance.now()
      const { candidates, lexicalMatchCount, uniqueMatchCount, coverage } = await collectWorkspaceData({ root, signal, pathPrefixes: args.paths, search: args })
      const retrievalMs = performance.now() - started
      let rankingMs = 0
      let usage = emptyRankingUsage()
      let ranking: "jev" | "lexical-fallback" | "no-candidates" = candidates.length ? "lexical-fallback" : "no-candidates"
      let model: string | null = null
      let warning: string | null = null
      let matches = candidates.map((c) => ({ ...c, relevance: null as number | null }))
      if (candidates.length) {
        signal.throwIfAborted()
        if (!this.enabled() || !this.options.isWorkspaceAllowed(root)) throw new Error("unavailable")
        const rankingStarted = performance.now()
        try {
          const result = await rankWithJev({ query: args.query, candidates, apiKey: this.options.settings().jev_api_key!, signal, fetchImpl: this.options.fetchImpl })
          model = result.model
          usage = result.usage
          ranking = "jev"
          matches = candidates.map((c, i) => ({ ...c, relevance: result.scores[i]! }))
            .sort((a, b) => b.relevance! - a.relevance! || b.lexicalScore - a.lexicalScore)
        } catch (error) {
          signal.throwIfAborted()
          if (error instanceof JevRankingError) usage = error.usage
          warning = "Jev ranking failed or timed out; these are local lexical matches. Try again or check the TypeSafe API key."
        } finally { rankingMs = performance.now() - rankingStarted }
      }
      return searchCodeOutput.parse({ ranking, model, warning, candidateCount: candidates.length, lexicalMatchCount, uniqueMatchCount, shortlistTruncated: uniqueMatchCount > candidates.length, matches: matches.slice(0, args.limit), coverage, usage, timingsMs: { retrieval: retrievalMs, ranking: rankingMs, total: performance.now() - started }, scope: SEARCH_SCOPE })
    }))
    return server
  }
}
