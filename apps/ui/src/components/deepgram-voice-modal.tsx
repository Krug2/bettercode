import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useAppearanceStore } from "@/lib/appearance-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useVoiceStore, BUILTIN_DEEPGRAM_KEY } from "@/lib/voice-store"
import { useAudioDevices } from "@/components/ai-elements/audio-devices"
import { MicIcon, Loader2Icon, CheckIcon, ChevronDownIcon } from "lucide-react"

// All languages supported by Deepgram (Nova-2/Nova-3)
const DEEPGRAM_LANGUAGES = [
  // Global / Multi
  { code: "multi", label: "Automatic Detection", flag: "🌍" },
  // English variants
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "en-GB", label: "English (UK)", flag: "🇬🇧" },
  { code: "en-AU", label: "English (Australia)", flag: "🇦🇺" },
  { code: "en-IN", label: "English (India)", flag: "🇮🇳" },
  { code: "en-NZ", label: "English (New Zealand)", flag: "🇳🇿" },
  // Spanish
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "es-419", label: "Spanish (Latin America)", flag: "🌎" },
  // French
  { code: "fr", label: "French", flag: "🇫🇷" },
  { code: "fr-CA", label: "French (Canada)", flag: "🇨🇦" },
  // German
  { code: "de", label: "German", flag: "🇩🇪" },
  { code: "de-CH", label: "German (Switzerland)", flag: "🇨🇭" },
  // Portuguese
  { code: "pt", label: "Portuguese", flag: "🇵🇹" },
  { code: "pt-BR", label: "Portuguese (Brazil)", flag: "🇧🇷" },
  // Chinese
  { code: "zh", label: "Chinese (Mandarin)", flag: "🇨🇳" },
  { code: "zh-CN", label: "Chinese (Simplified)", flag: "🇨🇳" },
  { code: "zh-TW", label: "Chinese (Traditional)", flag: "🇹🇼" },
  // East Asian
  { code: "ja", label: "Japanese", flag: "🇯🇵" },
  { code: "ko", label: "Korean", flag: "🇰🇷" },
  // South Asian
  { code: "hi", label: "Hindi", flag: "🇮🇳" },
  { code: "hi-Latn", label: "Hindi (Romanized)", flag: "🇮🇳" },
  { code: "ta", label: "Tamil", flag: "🇮🇳" },
  { code: "bn", label: "Bengali", flag: "🇧🇩" },
  { code: "gu", label: "Gujarati", flag: "🇮🇳" },
  { code: "kn", label: "Kannada", flag: "🇮🇳" },
  { code: "ml", label: "Malayalam", flag: "🇮🇳" },
  { code: "mr", label: "Marathi", flag: "🇮🇳" },
  { code: "pa", label: "Punjabi", flag: "🇮🇳" },
  { code: "te", label: "Telugu", flag: "🇮🇳" },
  // Southeast Asian
  { code: "id", label: "Indonesian", flag: "🇮🇩" },
  { code: "ms", label: "Malay", flag: "🇲🇾" },
  { code: "th", label: "Thai", flag: "🇹🇭" },
  { code: "vi", label: "Vietnamese", flag: "🇻🇳" },
  { code: "tl", label: "Tagalog", flag: "🇵🇭" },
  // Slavic
  { code: "ru", label: "Russian", flag: "🇷🇺" },
  { code: "uk", label: "Ukrainian", flag: "🇺🇦" },
  { code: "pl", label: "Polish", flag: "🇵🇱" },
  { code: "cs", label: "Czech", flag: "🇨🇿" },
  { code: "sk", label: "Slovak", flag: "🇸🇰" },
  { code: "bg", label: "Bulgarian", flag: "🇧🇬" },
  { code: "hr", label: "Croatian", flag: "🇭🇷" },
  { code: "sr", label: "Serbian", flag: "🇷🇸" },
  { code: "sl", label: "Slovenian", flag: "🇸🇮" },
  // Nordic
  { code: "sv", label: "Swedish", flag: "🇸🇪" },
  { code: "no", label: "Norwegian", flag: "🇳🇴" },
  { code: "da", label: "Danish", flag: "🇩🇰" },
  { code: "fi", label: "Finnish", flag: "🇫🇮" },
  // Other European
  { code: "nl", label: "Dutch", flag: "🇳🇱" },
  { code: "nl-BE", label: "Flemish", flag: "🇧🇪" },
  { code: "it", label: "Italian", flag: "🇮🇹" },
  { code: "el", label: "Greek", flag: "🇬🇷" },
  { code: "ro", label: "Romanian", flag: "🇷🇴" },
  { code: "hu", label: "Hungarian", flag: "🇭🇺" },
  { code: "ca", label: "Catalan", flag: "🏴" },
  { code: "lt", label: "Lithuanian", flag: "🇱🇹" },
  { code: "lv", label: "Latvian", flag: "🇱🇻" },
  { code: "et", label: "Estonian", flag: "🇪🇪" },
  // Turkic
  { code: "tr", label: "Turkish", flag: "🇹🇷" },
  { code: "az", label: "Azerbaijani", flag: "🇦🇿" },
  { code: "kk", label: "Kazakh", flag: "🇰🇿" },
  // Semitic / Middle Eastern
  { code: "ar", label: "Arabic", flag: "🇸🇦" },
  { code: "he", label: "Hebrew", flag: "🇮🇱" },
  { code: "fa", label: "Persian", flag: "🇮🇷" },
  // African
  { code: "sw", label: "Swahili", flag: "🇰🇪" },
  { code: "af", label: "Afrikaans", flag: "🇿🇦" },
  // Pacific
  { code: "mi", label: "Maori", flag: "🇳🇿" },
] as const

interface DeepgramVoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function DeepgramVoiceModal({ open, onOpenChange, onSaved }: DeepgramVoiceModalProps) {
  const isSimple = useAppearanceStore((s) => s.chatUiStyle === "simple")
  const voice = useVoiceStore()
  const { devices, loading: devicesLoading, hasPermission, loadDevices } = useAudioDevices()

  const [apiKey, setApiKey] = useState("")
  const [micId, setMicId] = useState("")
  const [lang, setLang] = useState("en")
  const [saving, setSaving] = useState(false)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [clearStoredKey, setClearStoredKey] = useState(false)

  const hasBuiltinKey = !!BUILTIN_DEEPGRAM_KEY
  const hasAnyKey = !!(
    apiKey.trim() ||
    BUILTIN_DEEPGRAM_KEY ||
    (voice.deepgramConfigured && !clearStoredKey)
  )

  // Sync from store when modal opens
  useEffect(() => {
    if (open) {
      setApiKey(voice.deepgramApiKey)
      setMicId(voice.micDeviceId)
      setLang(voice.voiceLanguage)
      setApiKeyOpen(!!voice.deepgramApiKey || voice.deepgramConfigured)
      setClearStoredKey(false)
    }
  }, [
    open,
    voice.deepgramApiKey,
    voice.deepgramConfigured,
    voice.micDeviceId,
    voice.voiceLanguage,
  ])

  // Request mic permission when modal opens
  useEffect(() => {
    if (open && !hasPermission && !devicesLoading) {
      loadDevices()
    }
  }, [open, hasPermission, devicesLoading, loadDevices])

  const handleSave = async () => {
    if (!hasAnyKey) return
    setSaving(true)
    try {
      await voice.update({
        ...(apiKey.trim()
          ? { deepgramApiKey: apiKey.trim() }
          : clearStoredKey
            ? { deepgramApiKey: "" }
            : {}),
        micDeviceId: micId,
        voiceLanguage: lang,
      })
      onOpenChange(false)
      onSaved?.()
    } catch {
      // voice-store already rolled back and surfaced the backend error.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-full max-w-[calc(100%-1rem)] gap-4 overflow-hidden p-5 sm:max-w-md sm:gap-5 sm:p-6 md:max-w-lg",
          isSimple && "gap-3 p-4 sm:gap-3 sm:p-4"
        )}
      >
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="flex items-center gap-2">
            <MicIcon className="size-5" />
            Voice Input
          </DialogTitle>
          <DialogDescription className="space-y-0.5">
            <span>Free voice-to-text powered by Deepgram.</span>
            {hasBuiltinKey && (
              <span className="block text-emerald-500/80">
                You have free usage included with BetterC0de — just select your mic and start talking.
              </span>
            )}
          </DialogDescription>
        </div>

        <div className={cn("flex min-w-0 flex-col", isSimple ? "gap-3" : "gap-4")}>
          {/* Microphone Selection */}
          <div className="min-w-0 space-y-2">
            <Label htmlFor="dg-mic">Microphone</Label>
            {devicesLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading devices...
              </div>
            ) : (
              <Select value={micId || "default"} onValueChange={(v) => setMicId(v === "default" ? "" : v)}>
                <SelectTrigger id="dg-mic" className="w-full min-w-0">
                  <SelectValue placeholder="System default microphone" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-64 w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width)">
                  <SelectItem value="default">System Default</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Language Selection */}
          <div className="min-w-0 space-y-2">
            <Label htmlFor="dg-lang">Language</Label>
            <Select value={lang} onValueChange={setLang}>
              <SelectTrigger id="dg-lang" className="w-full min-w-0">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-64 w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width)">
                {DEEPGRAM_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    <span className="mr-2">{l.flag}</span>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* API Key — same layout as mic/language sections */}
          <Collapsible open={apiKeyOpen} onOpenChange={setApiKeyOpen} className={cn("min-w-0 space-y-2 border-t border-border/60", isSimple ? "mt-2 pt-3" : "mt-3 pt-4")}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1 text-sm leading-none font-medium select-none"
              >
                <span className="shrink-0">API Key</span>
                <span className="truncate text-xs font-normal text-muted-foreground">(please read)</span>
                <ChevronDownIcon className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${apiKeyOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0 space-y-2">
              <Input
                type="password"
                placeholder={
                  voice.deepgramConfigured && !clearStoredKey
                    ? "Stored securely"
                    : "Paste your Deepgram API key..."
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="w-full min-w-0"
              />
              {voice.deepgramConfigured && !clearStoredKey ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearStoredKey(true)}
                >
                  Clear stored key
                </Button>
              ) : null}
              <p className="text-xs leading-relaxed break-words text-muted-foreground">
                {hasBuiltinKey
                  ? "BetterC0de includes free voice usage on your device. If you need more, "
                  : ""}
                create a free account at{" "}
                <button
                  type="button"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                  onClick={() => window.open("https://console.deepgram.com", "_blank")}
                >
                  console.deepgram.com
                </button>
                {" "}&mdash; you get $200 in free credits on signup, no credit card needed.
                Your own key gives you unlimited usage independent of BetterC0de.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasAnyKey || saving}>
            {saving ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckIcon className="mr-2 size-4" />
            )}
            {voice.setupComplete ? "Save" : "Save & Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
