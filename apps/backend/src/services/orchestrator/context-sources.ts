import { z } from "zod"
import { ORCHESTRATOR_CONTEXT_CHARS } from "@betterc0de/schema"
import type { Db } from "../../persistence/db"
import { HttpError } from "../../errors"
import type { ContextSourceReader } from "./context"

const MESSAGE_LIMIT = 100
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
})

/** Called only for an explicit desktop-owner grant, never directly from MCP. */
export function createContextSourceReader(db: Db): ContextSourceReader {
  const thread = db.prepare(
    "SELECT title FROM projection_threads WHERE thread_id = ? AND status = 'active'"
  )
  // Bound the rows and the text crossing from SQLite into JS. Do not copy tool output,
  // reasoning, attachments, system messages or hidden provider handoffs.
  const messages = db.prepare(`
    SELECT role, substr(json_extract(content_json, '$.text'), 1, ?) AS text
    FROM projection_messages WHERE thread_id = ? AND role IN ('user', 'assistant')
      AND json_valid(content_json)
      AND json_type(content_json, '$.text') = 'text'
      AND coalesce(json_extract(content_json, '$.extra.internalContext'), '') <> 'provider-handoff'
    ORDER BY sequence DESC LIMIT ?
  `)
  const plan = db.prepare(`
    SELECT substr(coalesce(json_extract(payload_json, '$.planMarkdown'),
      json_extract(payload_json, '$.plan_markdown'), json_extract(payload_json, '$.detail')), 1, ?) AS text
    FROM projection_thread_activities WHERE thread_id = ? AND kind = 'turn.proposed.completed'
    ORDER BY created_at DESC, activity_id DESC LIMIT 1
  `)
  return (source) => {
    const metadata = z
      .object({ title: z.string() })
      .safeParse(thread.get(source.threadId))
    if (!metadata.success) throw new HttpError(404, "Source thread not found.")
    if (source.kind === "plan") {
      const row = z
        .object({ text: z.string().min(1) })
        .safeParse(plan.get(ORCHESTRATOR_CONTEXT_CHARS + 1, source.threadId))
      if (!row.success)
        throw new HttpError(
          404,
          "This thread has no saved proposed plan. Paste a plan as a note instead."
        )
      return {
        source,
        title: `Plan: ${metadata.data.title}`.slice(0, 160),
        body: row.data.text.slice(0, ORCHESTRATOR_CONTEXT_CHARS),
        truncated: row.data.text.length > ORCHESTRATOR_CONTEXT_CHARS,
      }
    }
    const rows = z
      .array(messageSchema)
      .parse(
        messages.all(
          ORCHESTRATOR_CONTEXT_CHARS + 1,
          source.threadId,
          MESSAGE_LIMIT + 1
        )
      )
    const parts: string[] = []
    let remaining = ORCHESTRATOR_CONTEXT_CHARS
    let truncated = rows.length > MESSAGE_LIMIT
    for (const row of rows.slice(0, MESSAGE_LIMIT)) {
      if (!row.text.trim()) continue
      const text = `${row.role}: ${row.text}`
      const separator = parts.length ? 2 : 0
      if (text.length + separator > remaining) {
        // Keep complete recent messages when possible; a single oversized latest
        // message gets an explicitly marked excerpt instead of an empty snapshot.
        if (!parts.length) parts.push(text.slice(0, remaining))
        truncated = true
        break
      }
      parts.push(text)
      remaining -= text.length + separator
    }
    if (!parts.length)
      throw new HttpError(400, "This thread has no visible text to share.")
    return {
      source,
      title: metadata.data.title.slice(0, 160),
      body: parts.reverse().join("\n\n"),
      truncated,
    }
  }
}
