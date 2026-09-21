import { createHash, randomUUID } from "node:crypto"
import {
  ORCHESTRATOR_CONTEXT_ITEMS,
  orchestratorContextPreviewSchema,
  type OrchestratorContext,
  type OrchestratorContextAuthor,
  type OrchestratorContextGrant,
  type OrchestratorContextShare,
  type OrchestratorRecipient,
  type OrchestratorSession,
} from "@betterc0de/schema"
import { HttpError } from "../../errors"

export type ContextSnapshot = Pick<
  OrchestratorContext,
  "title" | "body" | "truncated" | "source"
>
export type ContextSourceReader = (source: {
  kind: "thread" | "plan"
  threadId: string
}) => ContextSnapshot

export function canReadContext(
  entry: OrchestratorContext,
  author: OrchestratorContextAuthor
): boolean {
  if (author.kind === "user") return true
  return (
    entry.recipient.kind === "team" ||
    (entry.recipient.kind === "main" && author.kind === "main") ||
    (entry.recipient.kind === "agent" &&
      entry.recipient.threadId === author.threadId) ||
    (entry.recipient.kind === "member" &&
      author.kind === "member" &&
      entry.recipient.memberId === author.memberId) ||
    (entry.author.kind !== "user" && entry.author.threadId === author.threadId)
  )
}

export function contextPreview(entry: OrchestratorContext) {
  return orchestratorContextPreviewSchema.parse(entry)
}

/** Immutable snapshots; routing is explicit. Forwarding never reads a new source thread. */
export function publishContext(
  session: OrchestratorSession,
  author: OrchestratorContextAuthor,
  input: OrchestratorContextShare | OrchestratorContextGrant,
  readSource: ContextSourceReader,
  persist: (session: OrchestratorSession) => void
): OrchestratorContext {
  validateRecipient(session, input.recipient)
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({ recipient: input.recipient, content: input.content })
    )
    .digest("hex")
  const existing = session.context.find(
    (entry) =>
      entry.requestId === input.requestId &&
      JSON.stringify(entry.author) === JSON.stringify(author)
  )
  if (existing) {
    if (existing.requestHash !== requestHash)
      throw new HttpError(
        409,
        "Context request ID already used for different content."
      )
    return structuredClone(existing)
  }
  if (session.context.length >= ORCHESTRATOR_CONTEXT_ITEMS)
    throw new HttpError(
      409,
      "Team context limit reached. Remove an old context item first."
    )
  const content = input.content
  const id = randomUUID()
  let snapshot: ContextSnapshot
  let originId: string = id
  if (content.kind === "forward") {
    const original = session.context.find(
      (entry) => entry.id === content.contextId && canReadContext(entry, author)
    )
    if (!original)
      throw new HttpError(404, "Shared context unavailable to this agent.")
    snapshot = original
    originId = original.originId
  } else if (content.kind === "note") {
    snapshot = {
      title: content.title,
      body: content.body,
      truncated: false,
      source: { kind: "note" },
    }
  } else {
    if (author.kind !== "user")
      throw new HttpError(403, "Only the user can grant source thread access.")
    snapshot = readSource(content)
  }
  const entry: OrchestratorContext = {
    id,
    originId,
    requestId: input.requestId,
    requestHash,
    author,
    recipient: input.recipient,
    title: snapshot.title,
    body: snapshot.body,
    truncated: snapshot.truncated,
    source: snapshot.source,
    createdAt: new Date().toISOString(),
    readBy: [],
  }
  session.context.push(entry)
  try {
    persist(session)
  } catch (error) {
    session.context.pop()
    throw error
  }
  return structuredClone(entry)
}

function validateRecipient(
  session: OrchestratorSession,
  recipient: OrchestratorRecipient
): void {
  if (
    recipient.kind === "agent" &&
    !session.jobs.some((job) => job.threadId === recipient.threadId)
  )
    throw new HttpError(400, "Unknown agent in this chat.")
  if (
    recipient.kind === "member" &&
    !session.team.members.some((member) => member.id === recipient.memberId)
  )
    throw new HttpError(400, "Unknown context recipient in this team.")
}
