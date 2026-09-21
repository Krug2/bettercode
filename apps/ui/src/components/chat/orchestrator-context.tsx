import { useEffect, useRef, useState } from "react"
import {
  ORCHESTRATOR_CONTEXT_CHARS,
  type ChatThread,
  type OrchestratorContext,
  type OrchestratorContextGrant,
  type OrchestratorRecipient,
  type OrchestratorSession,
} from "@betterc0de/schema"
import {
  ChevronDownIcon,
  FileTextIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { loadThreads } from "@/services/backend/coreApi"
import {
  grantOrchestratorContext,
  readOrchestratorContext,
  removeOrchestratorContext,
} from "@/services/backend/orchestratorApi"

function recipientLabel(
  recipient: OrchestratorRecipient,
  session: OrchestratorSession
): string {
  if (recipient.kind === "team") return "Whole team"
  if (recipient.kind === "main") return "Main model"
  if (recipient.kind === "agent")
    return (
      session.jobs.find((job) => job.threadId === recipient.threadId)?.name ||
      "Agent"
    )
  return (
    session.team.members.find((member) => member.id === recipient.memberId)
      ?.name ?? recipient.memberId
  )
}

export function OrchestratorContext({
  session,
  onChange,
}: {
  session: OrchestratorSession
  onChange: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<"thread" | "plan" | "note">("thread")
  const [recipient, setRecipient] = useState<OrchestratorRecipient>({
    kind: "team",
  })
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [sourceThreadId, setSourceThreadId] = useState("")
  const [search, setSearch] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<OrchestratorContext | null>(null)
  const mounted = useRef(false)
  const mutation = useRef(false)
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!adding) return
    let cancelled = false
    setLoadingThreads(true)
    void loadThreads()
      .then((value) => {
        if (!cancelled) {
          setThreads(value)
          setLoadingThreads(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Could not load threads. Close and reopen Share context to retry."
          )
          setLoadingThreads(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [adding])

  async function mutate(operation: () => Promise<unknown>, after?: () => void) {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
      if (mounted.current) {
        after?.()
        onChange()
      }
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Context operation failed."
        )
    } finally {
      mutation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function share() {
    const content: OrchestratorContextGrant["content"] =
      kind === "note"
        ? { kind, title: title.trim(), body: body.trim() }
        : { kind, threadId: sourceThreadId }
    const fingerprint = JSON.stringify({ recipient, content })
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, requestId: crypto.randomUUID() }
    const requestId = retry.current.requestId
    void mutate(
      () =>
        grantOrchestratorContext({
          threadId: session.threadId,
          requestId,
          recipient,
          content,
        }),
      () => {
        retry.current = null
        setAdding(false)
        setExpanded(true)
        setBody("")
        setTitle("")
      }
    )
  }

  const visibleThreads = threads.filter((thread) =>
    `${thread.title} ${thread.projectName}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  )
  const openEntry =
    opened && session.context.some((entry) => entry.id === opened.id)
      ? opened
      : null
  return (
    <div className="border-t border-border/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-2 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Share2Icon className="size-3.5" /> Shared context
          <span className="tabular-nums">{session.context.length}</span>
          <ChevronDownIcon
            className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {session.status === "ready" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setAdding((value) => !value)
              setExpanded(true)
              setError(null)
            }}
          >
            <PlusIcon className="size-3.5" />{" "}
            {adding ? "Close" : "Share context"}
          </Button>
        )}
      </div>
      {adding && session.status === "ready" && (
        <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              value={
                recipient.kind === "member"
                  ? `member:${recipient.memberId}`
                  : recipient.kind === "agent"
                    ? `agent:${recipient.threadId}`
                    : recipient.kind
              }
              disabled={busy}
              onValueChange={(value) =>
                setRecipient(
                  value === "main"
                    ? { kind: "main" }
                    : value === "team"
                      ? { kind: "team" }
                      : value.startsWith("agent:")
                        ? { kind: "agent", threadId: value.slice(6) }
                        : { kind: "member", memberId: value.slice(7) }
                )
              }
            >
              <SelectTrigger aria-label="Context recipient" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Whole team</SelectItem>
                <SelectItem value="main">Main model</SelectItem>
                {session.jobs.map((job) => (
                  <SelectItem
                    key={job.threadId}
                    value={`agent:${job.threadId}`}
                  >
                    {job.name ||
                      session.team.members.find(
                        (member) => member.id === job.memberId
                      )?.name ||
                      "Agent"}
                  </SelectItem>
                ))}
                {session.mode === "team" &&
                  session.team.members.map((member) => (
                    <SelectItem key={member.id} value={`member:${member.id}`}>
                      {member.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={kind}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "thread" || value === "plan" || value === "note")
                  setKind(value)
              }}
            >
              <SelectTrigger aria-label="Context source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thread">Thread snapshot</SelectItem>
                <SelectItem value="plan">Latest saved plan</SelectItem>
                <SelectItem value="note">Plan or information</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "note" ? (
            <>
              <Input
                aria-label="Context title"
                placeholder="e.g. Authentication plan"
                maxLength={160}
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Textarea
                aria-label="Context content"
                placeholder="Paste a plan, requirements or information for this agent…"
                maxLength={ORCHESTRATOR_CONTEXT_CHARS}
                value={body}
                disabled={busy}
                onChange={(event) => setBody(event.target.value)}
                className="max-h-64 min-h-28"
              />
            </>
          ) : (
            <>
              <Input
                aria-label="Search source threads"
                placeholder="Search threads or projects…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={busy || loadingThreads}
              />
              <Select
                value={sourceThreadId}
                disabled={busy || loadingThreads}
                onValueChange={setSourceThreadId}
              >
                <SelectTrigger aria-label="Source thread" className="w-full">
                  <SelectValue
                    placeholder={
                      loadingThreads ? "Loading threads…" : "Choose a thread"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sourceThreadId &&
                    !visibleThreads.some(
                      (thread) => thread.id === sourceThreadId
                    ) && (
                      <SelectItem value={sourceThreadId}>
                        {threads.find((thread) => thread.id === sourceThreadId)
                          ?.title ?? "Selected thread"}
                      </SelectItem>
                    )}
                  {visibleThreads.map((thread) => (
                    <SelectItem key={thread.id} value={thread.id}>
                      {thread.title || "Untitled"} · {thread.projectName}
                    </SelectItem>
                  ))}
                  {!visibleThreads.length && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      No matching threads
                    </div>
                  )}
                </SelectContent>
              </Select>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Copies up to 12,000 characters. Recipients can forward this context
            within the team. Agents fetch updates through their tools; sharing
            does not start a new run.
          </p>
          <Button
            size="sm"
            disabled={
              busy ||
              (kind === "note"
                ? !title.trim() || !body.trim()
                : !sourceThreadId)
            }
            onClick={share}
          >
            {busy ? "Sharing…" : "Share"}
          </Button>
        </div>
      )}
      {expanded && (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {!session.context.length && (
            <p className="py-1 text-xs text-muted-foreground">
              Give an agent a thread, plan or note. Shared findings will appear
              here.
            </p>
          )}
          {session.context.map((entry) => {
            const sender =
              entry.author.kind === "user"
                ? "You"
                : recipientLabel(
                    entry.author.kind === "main"
                      ? { kind: "main" }
                      : { kind: "member", memberId: entry.author.memberId },
                    session
                  )
            return (
              <div
                key={entry.id}
                className="rounded-lg border border-border/50"
              >
                <div className="flex items-center gap-2 p-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    aria-expanded={openEntry?.id === entry.id}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => {
                      if (openEntry?.id === entry.id) {
                        setOpened(null)
                        return
                      }
                      void mutate(async () => {
                        const value = await readOrchestratorContext(
                          session.threadId,
                          entry.id
                        )
                        if (mounted.current) setOpened(value)
                      })
                    }}
                  >
                    <FileTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 text-xs">
                      <span className="block truncate font-medium">
                        {entry.title}
                      </span>
                      <span className="mt-1 block text-muted-foreground">
                        {sender} → {recipientLabel(entry.recipient, session)} ·{" "}
                        {entry.readBy.length
                          ? `Fetched by ${entry.readBy.length}`
                          : "Not fetched yet"}
                        {entry.truncated ? " · Excerpt" : ""}
                        {entry.originId !== entry.id ? " · Forwarded" : ""}
                      </span>
                    </span>
                  </button>
                  {session.status === "ready" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      disabled={busy}
                      aria-label={`Remove ${entry.title}`}
                      title="Remove context and its forwarded copies"
                      onClick={() =>
                        void mutate(
                          () =>
                            removeOrchestratorContext(
                              session.threadId,
                              entry.id
                            ),
                          () => setOpened(null)
                        )
                      }
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  )}
                </div>
                {openEntry?.id === entry.id && (
                  <div className="border-t border-border/40 p-3">
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      {entry.source.kind === "note"
                        ? "Shared note"
                        : `${entry.source.kind === "plan" ? "Plan" : "Thread"} snapshot`}{" "}
                      · {new Date(entry.createdAt).toLocaleString()}
                    </p>
                    <pre className="font-sans text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {openEntry.body}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
          {session.context.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Removing context also removes forwarded copies. Content already
              fetched stays in the agent’s conversation.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
