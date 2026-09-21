import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useOnboardingStore } from "@/lib/onboarding-store"
import {
  SELECTABLE_THEME_TEMPLATES,
  useAppearanceStore,
} from "@/lib/appearance-store"
import { CheckIcon } from "lucide-react"
import { StepHeader, NavFooter } from "./shared"
import { ChatPreview } from "./chat-preview"

export function AppearanceStep() {
  const { nextStep, prevStep } = useOnboardingStore()
  const chatUiStyle = useAppearanceStore((s) => s.chatUiStyle)
  const template = useAppearanceStore((s) => s.template)
  const isSimple = chatUiStyle === "simple"

  return (
    <div className="w-full max-w-4xl">
      <StepHeader
        title="Appearance"
        description="Choose your UI style and theme. You can always change this later in Settings."
      />

      <div className="flex gap-6">
        {/* Left: Controls */}
        <div className="w-[260px] shrink-0 space-y-5">
          {/* UI Mode */}
          <div>
            <p className="mb-2.5 text-xs font-medium text-muted-foreground">
              UI Mode
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  useAppearanceStore.getState().set("chatUiStyle", "simple")
                }
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all",
                  isSimple
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted/30 hover:bg-muted/50"
                )}
              >
                <div className="flex h-12 w-full items-center justify-center rounded-lg bg-muted/50">
                  <div className="flex w-16 flex-col gap-1">
                    <div className="h-1 w-10 rounded-full bg-foreground/20" />
                    <div className="h-1 w-14 rounded-full bg-foreground/10" />
                    <div className="h-1 w-8 rounded-full bg-foreground/10" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-semibold">Simple</p>
                  <p className="text-[9px] text-muted-foreground">
                    Clean, focused
                  </p>
                </div>
                {isSimple && <CheckIcon className="size-3.5 text-primary" />}
              </button>
              <button
                type="button"
                onClick={() =>
                  useAppearanceStore.getState().set("chatUiStyle", "extended")
                }
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all",
                  !isSimple
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted/30 hover:bg-muted/50"
                )}
              >
                <div className="flex h-12 w-full items-center justify-center rounded-lg bg-muted/50">
                  <div className="flex w-16 flex-col gap-0.5">
                    <div className="flex gap-1">
                      <div className="h-1 w-3 rounded-full bg-foreground/25" />
                      <div className="h-1 w-5 rounded-full bg-foreground/15" />
                    </div>
                    <div className="h-1 w-14 rounded-full bg-foreground/10" />
                    <div className="flex gap-1">
                      <div className="h-1 w-6 rounded-full bg-foreground/15" />
                      <div className="h-1 w-4 rounded-full bg-foreground/20" />
                    </div>
                    <div className="h-1 w-10 rounded-full bg-foreground/10" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-semibold">Extended</p>
                  <p className="text-[9px] text-muted-foreground">
                    Full controls
                  </p>
                </div>
                {!isSimple && <CheckIcon className="size-3.5 text-primary" />}
              </button>
            </div>
          </div>

          {/* Theme */}
          <div>
            <p className="mb-2.5 text-xs font-medium text-muted-foreground">
              Theme
            </p>
            <div className="space-y-1.5">
              {SELECTABLE_THEME_TEMPLATES.map((tmpl) => {
                const isActive = template === tmpl.id
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() =>
                      useAppearanceStore.getState().applyTemplate(tmpl.id)
                    }
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 transition-all",
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border/50 hover:border-border"
                    )}
                  >
                    <div
                      className="flex h-6 w-10 shrink-0 gap-px overflow-hidden rounded border border-border/30"
                      style={{ background: tmpl.preview.sidebar }}
                    >
                      <div
                        className="flex-[3]"
                        style={{ background: tmpl.preview.bg }}
                      />
                      <div
                        className="flex-[1]"
                        style={{ background: tmpl.preview.sidebar }}
                      />
                      <div
                        className="mx-0.5 my-1 w-1 rounded-full"
                        style={{ background: tmpl.preview.accent }}
                      />
                    </div>
                    <span
                      className={cn(
                        "flex-1 text-left text-xs",
                        isActive && "font-medium"
                      )}
                    >
                      {tmpl.name}
                    </span>
                    <Badge variant="outline" className="text-[8px] capitalize">
                      {tmpl.mode}
                    </Badge>
                    {isActive && (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Live Preview
          </p>
          <div className="relative overflow-hidden rounded-xl border border-border/50 shadow-lg">
            <div style={{ height: 420 }}>
              <div
                className="origin-top-left"
                style={{
                  width: `${100 / 0.55}%`,
                  height: `${100 / 0.55}%`,
                  transform: "scale(0.55)",
                }}
              >
                <ChatPreview isSimple={isSimple} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <NavFooter onBack={prevStep} onNext={nextStep} />
    </div>
  )
}
