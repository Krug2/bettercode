import { useRef, useEffect, useMemo } from "react"
import { cn } from "@/lib/utils"
import { useMultiAgentStore, type AgentConfig } from "@/lib/multi-agent-store"
import { useChatStore, getThreadStream } from "@/lib/chat-store"
import { Spinner } from "@/components/kibo-ui/spinner"
import {
  CheckIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
  AlertCircleIcon,
  GitBranchIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// ── Unified message type for the group chat ──

interface GroupMessage {
  id: string
  agentId: string
  agentName: string
  agentColor: string
  content: string
  timestamp: string
  isBulletin?: boolean
}

// ── Agent status pill at the top ──

function AgentPill({ agent }: { agent: AgentConfig }) {
  const isStreaming = useChatStore((s) =>
    agent.threadId
      ? (s.streamingByThread[agent.threadId]?.isStreaming ?? false)
      : false
  )
  const active = isStreaming || agent.status === "working"

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors",
        active
          ? "border-border/40 bg-background/60"
          : agent.status === "done"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-border/20 bg-background/30"
      )}
    >
      <div
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: agent.color }}
      />
      <span className="text-[10px] font-medium">{agent.name}</span>
      {active && <Spinner variant="bars" size={10} className="text-primary" />}
      {agent.status === "done" && (
        <CheckIcon className="size-2.5 text-emerald-400" />
      )}
      {agent.status === "error" && (
        <AlertCircleIcon className="size-2.5 text-red-400" />
      )}
      {agent.status === "waiting" && !active && (
        <PauseIcon className="size-2.5 text-amber-400/60" />
      )}
      {agent.role && (
        <span className="text-[9px] text-muted-foreground/40">
          {agent.role}
        </span>
      )}
      {agent.branch && (
        <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/45">
          <GitBranchIcon className="size-2.5" />
          {agent.branch.split("/").slice(-1)[0]}
        </span>
      )}
    </div>
  )
}

// ── Single message bubble in the group chat ──

function GroupMessageBubble({
  msg,
  isStreaming,
}: {
  msg: GroupMessage
  isStreaming?: boolean
}) {
  return (
    <div className="group flex gap-2.5 px-4 py-1.5">
      {/* Avatar */}
      <div
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ backgroundColor: msg.agentColor }}
      >
        {msg.agentName[0]}
      </div>
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[11px] font-semibold"
            style={{ color: msg.agentColor }}
          >
            {msg.agentName}
          </span>
          <span className="text-[9px] text-muted-foreground/30">
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {isStreaming && (
            <Spinner variant="bars" size={10} className="text-primary" />
          )}
        </div>
        <div
          className={cn(
            "mt-0.5 text-[12px] leading-relaxed whitespace-pre-wrap",
            msg.isBulletin
              ? "text-muted-foreground/50 italic"
              : "text-foreground/85"
          )}
        >
          {msg.content}
        </div>
      </div>
    </div>
  )
}

// ── Streaming indicator for an agent currently typing ──

function StreamingBubble({ agent }: { agent: AgentConfig }) {
  const stream = useChatStore((s) =>
    agent.threadId ? getThreadStream(s, agent.threadId) : null
  )
  if (!stream?.isStreaming) return null

  const text = stream.streamingText
  if (!text) {
    return (
      <div className="flex gap-2.5 px-4 py-1.5">
        <div
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: agent.color }}
        >
          {agent.name[0]}
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <span
            className="text-[11px] font-semibold"
            style={{ color: agent.color }}
          >
            {agent.name}
          </span>
          <Spinner variant="bars" size={12} className="text-primary" />
          <span className="text-[10px] text-muted-foreground/40">
            typing...
          </span>
        </div>
      </div>
    )
  }

  return (
    <GroupMessageBubble
      msg={{
        id: `streaming-${agent.id}`,
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        content: text,
        timestamp: new Date().toISOString(),
      }}
      isStreaming
    />
  )
}

// ── Main grid view ──

export function MultiAgentGridView({
  onPause,
  onResume,
  onCancel,
}: {
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}) {
  const session = useMultiAgentStore((s) => s.session)
  const threads = useChatStore((s) => s.threads)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build a unified chronological message list from all agent threads
  const groupMessages = useMemo(() => {
    if (!session) return []
    const msgs: GroupMessage[] = []
    for (const agent of session.agents) {
      if (!agent.threadId) continue
      const thread = threads.find((t) => t.id === agent.threadId)
      if (!thread) continue
      for (const m of thread.messages) {
        if (m.role !== "assistant") continue
        msgs.push({
          id: m.id,
          agentId: agent.id,
          agentName: agent.name,
          agentColor: agent.color,
          content: m.content,
          timestamp: m.createdAt,
        })
      }
    }
    msgs.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    return msgs
  }, [session, threads])

  // Get currently streaming agents (for live typing indicators)
  const streamingByThread = useChatStore((s) => s.streamingByThread)
  const streamingAgents = useMemo(() => {
    if (!session) return []
    return session.agents.filter(
      (a) => a.threadId && streamingByThread[a.threadId]?.isStreaming
    )
  }, [session, streamingByThread])

  // Auto-scroll on new messages / streaming
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 150
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [groupMessages.length, streamingAgents.length, streamingByThread])

  if (!session || session.status === "configuring") return null

  const activeCount = session.agents.filter(
    (a) => a.status === "working"
  ).length
  const doneCount = session.agents.filter((a) => a.status === "done").length
  const isRunning = session.status === "running"
  const isPaused = session.status === "paused"
  const isDone =
    session.status === "completed" || session.status === "cancelled"

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-card/80 px-3 py-1.5 backdrop-blur-sm">
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 shrink-0 text-violet-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="M12 7v4m-5.3 3.3 3.6-3.6m7.4 3.6-3.6-3.6" />
        </svg>
        <span className="text-[11px] font-medium">Swarm</span>

        {isRunning && (
          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-medium text-blue-400">
            {activeCount} active
          </span>
        )}
        {doneCount > 0 && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-400">
            {doneCount} done
          </span>
        )}
        {isPaused && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-400">
            paused
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {isRunning && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[10px]"
              onClick={onPause}
            >
              <PauseIcon className="size-2.5" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[10px]"
              onClick={onResume}
            >
              <PlayIcon className="size-2.5" /> Resume
            </Button>
          )}
          {!isDone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[10px] text-red-400 hover:text-red-300"
              onClick={onCancel}
            >
              <XIcon className="size-2.5" /> Stop
            </Button>
          )}
          {isDone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => useMultiAgentStore.getState().clearSession()}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {/* Agent pills */}
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/20 px-3 py-2">
        {session.agents.map((agent) => (
          <AgentPill key={agent.id} agent={agent} />
        ))}
      </div>

      {/* Task banner */}
      <div className="shrink-0 border-b border-border/20 bg-violet-500/5 px-4 py-2">
        <p className="text-[11px] leading-relaxed text-violet-300/70">
          <span className="font-semibold text-violet-400">Task: </span>
          {session.task}
        </p>
      </div>

      {/* Unified group chat */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {groupMessages.length === 0 && streamingAgents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Spinner variant="bars" size={20} className="text-violet-400/60" />
            <p className="text-[11px] text-muted-foreground/40">
              Agents are starting to work...
            </p>
          </div>
        ) : (
          <>
            {groupMessages.map((msg) => (
              <GroupMessageBubble key={msg.id} msg={msg} />
            ))}
            {/* Live streaming indicators */}
            {streamingAgents.map((agent) => (
              <StreamingBubble key={`stream-${agent.id}`} agent={agent} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// Backward compat — no longer a floating panel
export function MultiAgentSessionPanel({
  onPause: _onPause,
  onResume: _onResume,
  onCancel: _onCancel,
}: {
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}) {
  return null
}
