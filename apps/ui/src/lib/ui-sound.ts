import { assetUrl } from "@/lib/asset-url"

export type UiMouseSoundKind =
  | "left-down"
  | "left-up"
  | "right-down"
  | "right-up"
  | "scroll-down"
  | "scroll-up"

export const KEYBOARD_SOUND_THEMES = [
  { id: "cherrymx-black-abs", name: "CherryMX Black - ABS keycaps" },
  { id: "cherrymx-black-pbt", name: "CherryMX Black - PBT keycaps" },
  { id: "cherrymx-blue-abs", name: "CherryMX Blue - ABS keycaps" },
  { id: "cherrymx-blue-pbt", name: "CherryMX Blue - PBT keycaps" },
  { id: "cherrymx-brown-abs", name: "CherryMX Brown - ABS keycaps" },
  { id: "cherrymx-brown-pbt", name: "CherryMX Brown - PBT keycaps" },
  { id: "cherrymx-red-pbt", name: "CherryMX Red - PBT keycaps" },
  { id: "eg-crystal-purple", name: "EG Crystal Purple" },
  { id: "eg-oreo", name: "EG Oreo" },
  { id: "nk-cream", name: "NK Cream" },
  { id: "topre-purple-hybrid-pbt", name: "Topre Purple Hybrid - PBT keycaps" },
] as const

export const MOUSE_SOUND_THEMES = [
  { id: "amazon-gaming", name: "Amazon Gaming Mouse" },
  { id: "apple-magic-mouse", name: "Apple Magic Mouse" },
  { id: "corsair-m65-elite", name: "Corsair M65 Elite" },
  { id: "harpoon-rgb", name: "Corsair Harpoon RGB" },
  { id: "logi-g502", name: "Logitech G502 Lightspeed" },
  { id: "logi-trackball", name: "Logitech M570 Trackball" },
  { id: "mamba-elite", name: "Razer Mamba Elite" },
] as const

type KeySpriteSegment = {
  startSeconds: number
  durationSeconds: number
}

type SingleKeyboardPack = {
  kind: "single"
  spriteUrl: string
  segments: KeySpriteSegment[]
}

type MultiKeyboardPack = {
  kind: "multi"
  downUrls: string[]
  upUrls: string[]
}

type KeyboardPack = SingleKeyboardPack | MultiKeyboardPack

type MousePack = {
  files: Partial<Record<UiMouseSoundKind, string>>
  fallbackFiles: string[]
}

type SoundConfig = {
  key_define_type?: string
  sound?: string
  defines?: Record<string, unknown>
}

const AUDIO_EXT_RE = /\.(ogg|wav|mp3|m4a)$/i

const keyboardPackCache = new Map<string, Promise<KeyboardPack | null>>()
const mousePackCache = new Map<string, Promise<MousePack | null>>()
const bufferCache = new Map<string, Promise<AudioBuffer | null>>()

let audioContext: AudioContext | null = null
let lastTypingSoundAt = 0
let lastClickSoundAt = 0

const MIN_TYPING_INTERVAL_MS = 12
const MIN_CLICK_INTERVAL_MS = 20

const MOUSE_DEFINE_KEY_MAP: Record<UiMouseSoundKind, string> = {
  "left-down": "1",
  "left-up": "01",
  "right-down": "2",
  "right-up": "02",
  "scroll-down": "3",
  "scroll-up": "03",
}

function encodeAssetPath(path: string): string {
  const encoded = path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return assetUrl(encoded)
}

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => { /* Expected: AudioContext resume may fail (autoplay policy) */ })
  }
  return audioContext
}

function clampVolumePercent(volumePercent: number): number {
  if (!Number.isFinite(volumePercent)) return 0
  return Math.max(0, Math.min(1, volumePercent / 100))
}

function randomItem<T>(items: T[]): T | null {
  if (!items.length) return null
  return items[Math.floor(Math.random() * items.length)] ?? null
}

async function loadJsonConfig(url: string): Promise<SoundConfig | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as SoundConfig
  } catch {
    return null
  }
}

function parseSingleSegments(
  defines: Record<string, unknown>
): KeySpriteSegment[] {
  const segments: KeySpriteSegment[] = []
  for (const value of Object.values(defines)) {
    if (!Array.isArray(value) || value.length < 2) continue
    const start = value[0]
    const duration = value[1]
    if (typeof start !== "number" || typeof duration !== "number") continue
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue
    if (duration <= 0) continue
    segments.push({
      startSeconds: start / 1000,
      durationSeconds: duration / 1000,
    })
  }
  return segments
}

function parseMultiFiles(defines: Record<string, unknown>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of Object.values(defines)) {
    if (typeof value !== "string") continue
    if (!AUDIO_EXT_RE.test(value)) continue
    const key = value.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

async function loadKeyboardPack(themeId: string): Promise<KeyboardPack | null> {
  if (!keyboardPackCache.has(themeId)) {
    keyboardPackCache.set(
      themeId,
      (async () => {
        const configUrl = encodeAssetPath(
          `sounds/mechvibes/keys/${themeId}/config.json`
        )
        const config = await loadJsonConfig(configUrl)
        if (!config) return null
        const defines =
          config.defines && typeof config.defines === "object"
            ? config.defines
            : {}
        if (config.key_define_type === "single") {
          const segments = parseSingleSegments(defines)
          const spriteFile =
            typeof config.sound === "string" && AUDIO_EXT_RE.test(config.sound)
              ? config.sound
              : "sound.ogg"
          if (!segments.length) return null
          return {
            kind: "single",
            spriteUrl: encodeAssetPath(
              `sounds/mechvibes/keys/${themeId}/${spriteFile}`
            ),
            segments,
          } as SingleKeyboardPack
        }

        const files = parseMultiFiles(defines)
        if (!files.length) return null
        const downFiles = files.filter((file) => !/up/i.test(file))
        const upFiles = files.filter((file) => /up/i.test(file))
        return {
          kind: "multi",
          downUrls: (downFiles.length ? downFiles : files).map((file) =>
            encodeAssetPath(`sounds/mechvibes/keys/${themeId}/${file}`)
          ),
          upUrls: upFiles.map((file) =>
            encodeAssetPath(`sounds/mechvibes/keys/${themeId}/${file}`)
          ),
        } as MultiKeyboardPack
      })()
    )
  }
  return keyboardPackCache.get(themeId)!
}

async function loadMousePack(themeId: string): Promise<MousePack | null> {
  if (!mousePackCache.has(themeId)) {
    mousePackCache.set(
      themeId,
      (async () => {
        const configUrl = encodeAssetPath(
          `sounds/mechvibes/mouse/${themeId}/config.json`
        )
        const config = await loadJsonConfig(configUrl)
        if (!config) return null
        const defines =
          config.defines && typeof config.defines === "object"
            ? config.defines
            : {}
        const files: Partial<Record<UiMouseSoundKind, string>> = {}
        for (const [kind, defineKey] of Object.entries(
          MOUSE_DEFINE_KEY_MAP
        ) as [UiMouseSoundKind, string][]) {
          const value = defines[defineKey]
          if (typeof value === "string" && AUDIO_EXT_RE.test(value)) {
            files[kind] = encodeAssetPath(
              `sounds/mechvibes/mouse/${themeId}/${value}`
            )
          }
        }

        const fallbackFiles = parseMultiFiles(defines).map((file) =>
          encodeAssetPath(`sounds/mechvibes/mouse/${themeId}/${file}`)
        )
        return { files, fallbackFiles }
      })()
    )
  }
  return mousePackCache.get(themeId)!
}

async function getAudioBuffer(url: string): Promise<AudioBuffer | null> {
  if (!bufferCache.has(url)) {
    bufferCache.set(
      url,
      (async () => {
        try {
          const response = await fetch(url)
          if (!response.ok) return null
          const arrayBuffer = await response.arrayBuffer()
          const ctx = await getAudioContext()
          return await ctx.decodeAudioData(arrayBuffer.slice(0))
        } catch {
          return null
        }
      })()
    )
  }
  return bufferCache.get(url)!
}

async function playBuffer(
  url: string,
  volumePercent: number,
  startSeconds: number = 0,
  durationSeconds?: number
) {
  const volume = clampVolumePercent(volumePercent)
  if (volume <= 0) return

  const ctx = await getAudioContext()
  const buffer = await getAudioBuffer(url)
  if (!buffer) return

  const source = ctx.createBufferSource()
  source.buffer = buffer

  const gainNode = ctx.createGain()
  gainNode.gain.value = volume

  source.connect(gainNode)
  gainNode.connect(ctx.destination)

  const safeStart = Math.max(0, Math.min(startSeconds, buffer.duration - 0.01))
  try {
    if (
      durationSeconds &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
    ) {
      const safeDuration = Math.max(
        0.01,
        Math.min(durationSeconds, buffer.duration - safeStart)
      )
      source.start(0, safeStart, safeDuration)
    } else {
      source.start(0, safeStart)
    }
  } catch {
    // noop
  }
}

export function isEditableElementTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return !!target.closest("input, textarea, [contenteditable='true']")
}

export function shouldPlayTypingSound(event: KeyboardEvent): boolean {
  if (event.isComposing) return false
  if (event.repeat) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key.length === 1) return true
  return (
    event.key === "Backspace" ||
    event.key === "Enter" ||
    event.key === "Tab" ||
    event.key === " "
  )
}

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // Opt-out: elements explicitly marked should never trigger click sounds
  if (target.closest("[data-ui-sound-ignore='true']")) return false

  // Skip text input fields and editable regions — they play keyboard typing sounds instead
  if (
    target.closest(
      "input[type='text'], input[type='search'], input[type='url'], input[type='email'], input[type='number'], input[type='password'], input[type='tel'], textarea, [contenteditable='true'], [contenteditable=''], .monaco-editor, .xterm"
    )
  ) {
    return false
  }

  // Any other click in the app counts — no whitelist restriction.
  return true
}

export async function preloadUiSoundThemes(
  keyboardThemeId: string,
  mouseThemeId: string
) {
  await Promise.all([
    loadKeyboardPack(keyboardThemeId),
    loadMousePack(mouseThemeId),
  ]).catch(() => { /* Expected: sound theme preload is best-effort */ })
}

export async function playUiTypingSound(opts: {
  keyboardThemeId: string
  volume: number
  phase?: "down" | "up"
}) {
  const now = Date.now()
  if (now - lastTypingSoundAt < MIN_TYPING_INTERVAL_MS) return
  lastTypingSoundAt = now

  const pack = await loadKeyboardPack(opts.keyboardThemeId)
  if (!pack) return

  if (pack.kind === "single") {
    const segment = randomItem(pack.segments)
    if (!segment) return
    await playBuffer(
      pack.spriteUrl,
      opts.volume,
      segment.startSeconds,
      segment.durationSeconds
    )
    return
  }

  if (opts.phase === "up" && pack.upUrls.length > 0) {
    const sample = randomItem(pack.upUrls)
    if (!sample) return
    await playBuffer(sample, opts.volume)
    return
  }

  const sample = randomItem(pack.downUrls)
  if (!sample) return
  await playBuffer(sample, opts.volume)
}

export async function playUiClickSound(opts: {
  mouseThemeId: string
  volume: number
  kind?: UiMouseSoundKind
}) {
  const now = Date.now()
  if (now - lastClickSoundAt < MIN_CLICK_INTERVAL_MS) return
  lastClickSoundAt = now

  const pack = await loadMousePack(opts.mouseThemeId)
  if (!pack) return

  const kind = opts.kind || "left-down"
  const mapped = pack.files[kind]
  if (mapped) {
    await playBuffer(mapped, opts.volume)
    return
  }

  const fallback = randomItem(pack.fallbackFiles)
  if (!fallback) return
  await playBuffer(fallback, opts.volume)
}

export async function playUiSoundPreview(opts: {
  keyboardThemeId: string
  mouseThemeId: string
  volume: number
}) {
  await playUiTypingSound({
    keyboardThemeId: opts.keyboardThemeId,
    volume: opts.volume,
    phase: "down",
  })
  setTimeout(() => {
    playUiClickSound({
      mouseThemeId: opts.mouseThemeId,
      volume: opts.volume,
      kind: "left-down",
    }).catch(() => { /* Expected: sound preview playback is best-effort */ })
  }, 90)
}
