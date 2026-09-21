import { z } from "zod"

export type DictationPhase = "idle" | "connecting" | "recording" | "finishing"
export interface DeepgramCallbacks {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onEnd?: () => void
}

const resultSchema = z.object({
  type: z.literal("Results"),
  is_final: z.boolean(),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string() })).min(1),
  }),
})
const FINAL_RESULT_TIMEOUT_MS = 5000
const AUDIO_CHUNK_MS = 100

interface DeepgramSessionOptions {
  language: string
  getStream: () => Promise<MediaStream>
  getAuth: () => Promise<{ protocol: "token" | "bearer"; credential: string }>
  callbacks: DeepgramCallbacks
  onPhase: (phase: DictationPhase) => void
  onError: (message: string) => void
}

/** One recording owns its audio, socket and callbacks until the final server close. */
export class DeepgramSession {
  private phase: DictationPhase = "connecting"
  private ended = false
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private socket: WebSocket | null = null
  private finishTimer: ReturnType<typeof setTimeout> | undefined

  private readonly options: DeepgramSessionOptions

  constructor(options: DeepgramSessionOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    if (this.ended) return
    this.options.onPhase("connecting")
    try {
      const stream = await this.options.getStream()
      if (this.ended) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      this.stream = stream
      const auth = await this.options.getAuth()
      if (this.ended) return
      const params = new URLSearchParams({
        model: "nova-3", language: this.options.language, punctuate: "true",
        smart_format: "true", interim_results: "true", endpointing: "200", vad_events: "true",
      })
      const socket = new WebSocket("wss://api.deepgram.com/v1/listen?" + params, [auth.protocol, auth.credential])
      this.socket = socket
      socket.onopen = () => {
        if (this.ended) return
        try {
          const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus" : "audio/webm"
          const recorder = new MediaRecorder(stream, { mimeType })
          this.recorder = recorder
          recorder.ondataavailable = (event) => {
            if (!this.ended && event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              try { socket.send(event.data) } catch { this.fail("Could not send microphone audio") }
            }
          }
          recorder.onstop = () => {
            if (!this.ended && this.phase === "finishing") this.closeStream()
          }
          recorder.onerror = () => this.fail("Microphone recording failed")
          recorder.start(AUDIO_CHUNK_MS)
          this.phase = "recording"
          this.options.onPhase(this.phase)
        } catch {
          this.fail("Could not start microphone recording")
        }
      }
      socket.onmessage = (event) => {
        if (this.ended || typeof event.data !== "string") return
        let raw: unknown
        try { raw = JSON.parse(event.data) } catch { return }
        if (raw && typeof raw === "object" && "type" in raw && raw.type === "Error") {
          this.fail("Deepgram transcription failed")
          return
        }
        const parsed = resultSchema.safeParse(raw)
        if (!parsed.success) return // Metadata and VAD messages are not transcripts.
        const transcript = parsed.data.channel.alternatives[0]?.transcript
        if (transcript === undefined) return
        if (parsed.data.is_final) this.options.callbacks.onFinal(transcript)
        else this.options.callbacks.onInterim(transcript)
      }
      socket.onerror = () => this.fail("Deepgram connection failed — check your API key")
      socket.onclose = (event) => {
        if (this.ended) return
        if (event.code !== 1000) {
          this.fail("Deepgram connection closed unexpectedly")
        } else {
          this.finish()
        }
      }
    } catch (error) {
      if (!this.ended) this.fail(error instanceof Error ? error.message : "Failed to start recording")
    }
  }

  /** Flush the recorder first; keep receiving until Deepgram finishes CloseStream. */
  stop(): void {
    if (this.ended || this.phase === "finishing") return
    if (this.phase === "connecting") { this.finish(); return }
    this.phase = "finishing"
    this.options.onPhase(this.phase)
    this.finishTimer = setTimeout(() => this.fail("Final transcription timed out. Please try again."), FINAL_RESULT_TIMEOUT_MS)
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop()
      else this.closeStream()
    } catch {
      this.fail("Could not finish microphone recording")
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
  }

  /** Immediate cancellation for unmount, manual editing or submission. */
  cancel(): void { this.finish() }

  private closeStream(): void {
    if (this.ended) return
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.fail("Deepgram connection closed before transcription finished")
      return
    }
    try { this.socket.send(JSON.stringify({ type: "CloseStream" })) }
    catch { this.fail("Could not finalize transcription") }
  }

  private fail(message: string): void {
    if (this.ended) return
    this.options.onError(message)
    this.finish()
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.finishTimer)
    const recorder = this.recorder
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== "inactive") recorder.stop()
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    const socket = this.socket
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
    }
    this.stream = null
    this.recorder = null
    this.socket = null
    this.phase = "idle"
    this.options.callbacks.onEnd?.()
    this.options.onPhase("idle")
  }
}
