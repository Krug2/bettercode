import { isCumulativeToolOutputPayload } from "../provider/activity-projection"

type JsonObject = Record<string, unknown>
interface Snapshot {
  readonly key: string
  readonly frame: unknown
  readonly payload: JsonObject
  readonly bytes: number
}
interface SnapshotBufferOptions {
  readonly emit: (frame: unknown) => void
  readonly onError: (error: unknown) => void
  readonly windowMs?: number
  readonly maxItems?: number
  readonly maxBytes?: number
}

function object(value: unknown): JsonObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject
  return undefined
}

function snapshot(frame: unknown): Omit<Snapshot, "bytes"> | undefined {
  const envelope = object(frame)
  const data = object(envelope?.data)
  const payload = object(data?.payload)
  if (!envelope || !data || !payload || !isCumulativeToolOutputPayload(payload)) return
  const channel = envelope.channel
  if (channel === "thread.activity" ? data.kind !== "tool.updated"
    : channel !== "provider.runtimeEvent" || data.event_type !== "tool_call_delta") return
  const thread = data.thread_id ?? data.threadId
  const tool = payload.tool_id ?? payload.toolId
  if (typeof thread !== "string" || !thread.trim() || typeof tool !== "string" || !tool.trim()) return
  return {
    frame, payload,
    key: JSON.stringify([
      channel, thread,
      data.providerInstanceId ?? payload.providerInstanceId ?? payload.provider_instance_id ?? payload.providerKind ?? null,
      data.turnId ?? payload.turnId ?? payload.turn_id ?? null,
      tool,
    ]),
  }
}

export function toolSnapshotKey(frame: unknown): string | null {
  return snapshot(frame)?.key ?? null
}

/** Buffers replaceable wire snapshots after persistence, before replay sequence allocation. */
export class ToolSnapshotBuffer {
  private readonly pending = new Map<string, Snapshot>()
  private bytes = 0
  private deadline: ReturnType<typeof setTimeout> | undefined
  private draining = false

  constructor(private readonly options: SnapshotBufferOptions) {}

  offer(frame: unknown): void {
    const incoming = this.draining ? undefined : snapshot(frame)
    if (!incoming) {
      this.flush()
      this.options.emit(frame)
      return
    }
    const previous = this.pending.get(incoming.key)
    // Output snapshots cannot erase an independently reported command input or name.
    if (previous && object(frame)?.channel === "provider.runtimeEvent" &&
      ["input", "tool_name"].some(field => previous.payload[field] !== undefined && incoming.payload[field] === undefined)) {
      this.flush()
    } else if (previous) {
      this.pending.delete(incoming.key)
      this.bytes -= previous.bytes
    }
    const bytes = Buffer.byteLength(JSON.stringify(frame), "utf8")
    const byteLimit = this.options.maxBytes ?? 1024 * 1024
    if (this.pending.size >= (this.options.maxItems ?? 512) || this.bytes + bytes > byteLimit) this.flush()
    if (bytes > byteLimit) {
      this.options.emit(frame)
      return
    }
    // Map insertion order tracks each survivor's most recent source position in O(1).
    this.pending.set(incoming.key, { ...incoming, bytes })
    this.bytes += bytes
    if (!this.deadline) {
      this.deadline = setTimeout(() => this.flush(), this.options.windowMs ?? 50)
      this.deadline.unref?.()
    }
  }

  flush(): void {
    if (this.deadline) clearTimeout(this.deadline)
    this.deadline = undefined
    const batch = Array.from(this.pending.values())
    this.pending.clear()
    this.bytes = 0
    for (const item of batch) {
      try { this.options.emit(item.frame) }
      catch (error) { this.options.onError(error) }
    }
  }

  /** Shutdown still delivers final provider events, but never starts another timer. */
  drain(): void {
    this.draining = true
    this.flush()
  }
}
