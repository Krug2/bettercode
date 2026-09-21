import { Worker } from "node:worker_threads"
import { HttpError } from "../../errors"

export interface RegexLineMatch {
  line: number
  index: number
  length: number
}

// This function is serialized into the worker; keep it independent of imports.
function matchLines(input: {
  text: string
  source: string
  flags: string
  limit: number
  wholeWord: boolean
}): RegexLineMatch[] {
  const regex = new RegExp(input.source, input.flags)
  const matches: RegexLineMatch[] = []
  const lines = input.text.split(/\r\n|\r|\n/g)
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line] ?? ""
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const length = match[0].length
      const before = text[match.index - 1] ?? ""
      const after = text[match.index + length] ?? ""
      if (!input.wholeWord || (!/[A-Za-z0-9_$-]/.test(before) && !/[A-Za-z0-9_$-]/.test(after))) {
        matches.push({ line, index: match.index, length: Math.max(1, length) })
        if (matches.length >= input.limit) return matches
      }
      if (length === 0) regex.lastIndex = match.index + 1
    }
  }
  return matches
}

/** One worker per admitted regex search, reused for all of its files. */
export class RegexSearch {
  private readonly worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
     const matchLines = ${matchLines.toString()};
     parentPort.on('message', input => parentPort.postMessage(matchLines(input)));`,
    { eval: true, resourceLimits: { maxOldGenerationSizeMb: 32 } },
  )
  private failure: Error | null = null

  constructor() {
    this.worker.on("error", (error) => { this.failure = error })
  }

  async match(text: string, regex: RegExp, limit: number, wholeWord: boolean, deadline: number): Promise<RegexLineMatch[]> {
    if (this.failure) throw this.failure
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.worker.off("message", onMessage)
        this.worker.off("error", onError)
        this.worker.off("exit", onExit)
      }
      const onMessage = (matches: RegexLineMatch[]) => { cleanup(); resolve(matches) }
      const onError = (error: Error) => { cleanup(); reject(error) }
      const onExit = () => onError(new HttpError(503, "Regex search worker stopped.", "search_worker_stopped"))
      const timer = setTimeout(() => {
        onError(new HttpError(408, "Regex search exceeded its execution budget.", "search_timeout"))
        void this.worker.terminate()
      }, Math.max(1, Math.min(1_000, deadline - Date.now())))
      this.worker.once("message", onMessage)
      this.worker.once("error", onError)
      this.worker.once("exit", onExit)
      this.worker.postMessage({ text, source: regex.source, flags: regex.flags, limit, wholeWord })
    })
  }

  async close(): Promise<void> { await this.worker.terminate() }
}
