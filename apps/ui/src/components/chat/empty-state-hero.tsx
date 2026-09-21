import {
  ArrowDownLeftIcon,
  BlocksIcon,
  BugIcon,
  FolderIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  PanelsTopLeftIcon,
  PenToolIcon,
  SparklesIcon,
  TelescopeIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react"
import { useChatStore } from "@/lib/chat-store"
import { cn } from "@/lib/utils"

export type StartSurfaceVariant = "agent" | "editor" | "design"

export interface StartSuggestion {
  label: string
  description: string
  icon: LucideIcon
  prompt: string
}

export interface StartSurface {
  eyebrow: string
  eyebrowIcon: LucideIcon
  headline: string
  /** Project label shown separately so long names never crowd the headline. */
  projectSuffix: string | null
  lede: string
  suggestions: readonly StartSuggestion[]
}

const AGENT_SUGGESTIONS: readonly StartSuggestion[] = [
  {
    label: "Explore and understand code",
    description: "Map the architecture, modules, and important data flows.",
    icon: TelescopeIcon,
    prompt:
      "Explore the codebase and explain the architecture, the key modules, and how they fit together.",
  },
  {
    label: "Create a feature or tool",
    description: "Turn an idea into a scoped, working implementation.",
    icon: WandSparklesIcon,
    prompt: "Build a new feature: ",
  },
  {
    label: "Review the code",
    description: "Find concrete issues and recommend focused improvements.",
    icon: ListChecksIcon,
    prompt: "Review my uncommitted changes and suggest improvements.",
  },
  {
    label: "Find and fix a bug",
    description: "Trace the cause, apply a fix, and verify the behavior.",
    icon: BugIcon,
    prompt: "Find and fix this bug: ",
  },
]

const DESIGN_SUGGESTIONS: readonly StartSuggestion[] = [
  {
    label: "Build a landing page",
    description: "Hero, sections, and a call to action from your brief.",
    icon: LayoutTemplateIcon,
    prompt:
      "Design and build a landing page for this project: a hero, the key sections, and one clear call to action. Use the brief as the source of truth and keep it responsive.",
  },
  {
    label: "Design a screen or flow",
    description: "A dashboard, a settings page, or a multi-step flow.",
    icon: PanelsTopLeftIcon,
    prompt: "Design a new screen: ",
  },
  {
    label: "Polish what's in the preview",
    description: "Spacing, hierarchy, states, and responsive behavior.",
    icon: SparklesIcon,
    prompt:
      "Polish the page currently in the preview: tighten spacing and hierarchy, add hover and focus states, and make sure it works at phone width.",
  },
  {
    label: "Build a component",
    description: "A reusable piece that matches the existing style.",
    icon: BlocksIcon,
    prompt: "Build a reusable component that matches the existing style: ",
  },
]

/**
 * What the empty thread offers, per app mode. Pure so the copy and the
 * prompts can be asserted without rendering; the component only lays it out.
 */
export function resolveStartSurface(
  variant: StartSurfaceVariant,
  projectName: string | null | undefined
): StartSurface {
  const projectSuffix = projectName?.trim() ? projectName.trim() : null
  if (variant === "design") {
    return {
      eyebrow: "Canvas session",
      eyebrowIcon: PenToolIcon,
      headline: "What should we design",
      projectSuffix,
      lede: "Pick a starting point. The brief and the live preview travel with every prompt.",
      suggestions: DESIGN_SUGGESTIONS,
    }
  }
  return {
    eyebrow: "Start a task",
    eyebrowIcon: MessagesSquareIcon,
    headline: "What should we build",
    projectSuffix,
    lede: "Choose a starting point, or describe your task below.",
    suggestions: AGENT_SUGGESTIONS,
  }
}

function insertPrompt(text: string, threadId: string | null) {
  window.dispatchEvent(
    new CustomEvent("betterc0de:insert-prompt", { detail: { text, threadId } })
  )
}

/**
 * Empty-thread start surface. Cards drop a prompt into the composer through
 * the `betterc0de:insert-prompt` event (handled by `ComposerInsertPromptSync`
 * in chat-composer.tsx).
 *
 * The layout responds to the *column* it sits in, not the window: the same
 * component renders in the wide agent transcript and in the 350–390px design
 * side panel, and a viewport breakpoint would put two columns into the narrow
 * one. `@container` decides — one column and a smaller headline under 520px, which keeps the default 480px design column single-column with roomy cards.
 * The editor variant is a compact chip row because that side panel has no
 * room for a start surface at all.
 */
export function EmptyStateHero({
  variant,
  threadId,
}: {
  variant: StartSurfaceVariant
  threadId: string | null
}) {
  const projectName = useChatStore(
    (s) => s.threads.find((t) => t.id === threadId)?.projectName
  )
  const surface = resolveStartSurface(variant, projectName)

  if (variant === "editor") {
    return (
      <div className="m-auto flex w-full max-w-sm flex-col items-center justify-center px-4 py-3 text-center">
        <h2 className="text-sm font-semibold tracking-tight">
          Work with your code
        </h2>
        <p className="mt-1 max-w-64 text-[11px] leading-[18px] text-muted-foreground">
          Ask a question, describe a change, or add a selection from the editor.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {surface.suggestions.slice(2).map(({ label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => insertPrompt(prompt, threadId)}
              className="rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const EyebrowIcon = surface.eyebrowIcon
  return (
    <section
      data-start-surface={variant}
      className="@container flex w-full flex-1 flex-col justify-center py-7"
    >
      <div className="w-full min-w-0">
        <header className="mb-7 text-left @min-[520px]:mb-8">
          <div className="mb-5 flex min-w-0 items-center justify-between gap-4">
            <span className="flex shrink-0 items-center gap-2 text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
              <EyebrowIcon
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.6}
              />
              {surface.eyebrow}
            </span>
            {surface.projectSuffix && (
              <span
                title={surface.projectSuffix}
                className="flex max-w-[60%] min-w-0 items-center gap-1.5 rounded-md bg-foreground/[0.035] px-2 py-1 text-[11px] text-muted-foreground"
              >
                <FolderIcon
                  aria-hidden="true"
                  className="size-3 shrink-0"
                  strokeWidth={1.6}
                />
                <span className="truncate">{surface.projectSuffix}</span>
              </span>
            )}
          </div>
          <h2 className="!m-0 !text-[28px] !leading-[1.12] !font-medium !tracking-[-0.045em] text-balance text-foreground @min-[520px]:!text-[42px]">
            {surface.headline}?
          </h2>
          <p className="!mt-3 !mb-0 max-w-[560px] text-[13px] leading-5 text-pretty text-muted-foreground @min-[520px]:text-sm">
            {surface.lede}
          </p>
        </header>

        <div className="grid w-full grid-cols-1 gap-3 @min-[520px]:grid-cols-2">
          {surface.suggestions.map(
            ({ label, description, icon: Icon, prompt }) => (
              <button
                key={label}
                type="button"
                onClick={() => insertPrompt(prompt, threadId)}
                className={cn(
                  "group flex min-w-0 items-start gap-3 rounded-2xl border border-foreground/[0.07] bg-foreground/[0.018] p-4 text-left @min-[520px]:min-h-[162px] @min-[520px]:flex-col @min-[520px]:gap-0 @min-[520px]:p-5",
                  "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out",
                  "hover:-translate-y-0.5 hover:border-foreground/[0.16] hover:bg-foreground/[0.035] hover:shadow-[0_8px_24px_-16px_rgba(0,0,0,0.3)]",
                  "active:translate-y-0 active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none",
                  "focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center justify-between gap-3 @min-[520px]:w-full"
                >
                  <span className="flex size-9 items-center justify-center rounded-xl bg-foreground/[0.045] text-foreground/75 transition-colors duration-200 group-hover:bg-foreground/[0.075] group-hover:text-foreground motion-reduce:transition-none">
                    <Icon className="size-[18px]" strokeWidth={1.6} />
                  </span>
                  <span className="hidden items-center gap-1.5 text-[10px] font-medium text-muted-foreground @min-[520px]:flex">
                    <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                      Use prompt
                    </span>
                    <ArrowDownLeftIcon
                      className="size-3.5 text-muted-foreground/50 transition-colors duration-150 group-hover:text-foreground motion-reduce:transition-none"
                      strokeWidth={1.7}
                    />
                  </span>
                </span>
                <span className="block min-w-0 flex-1 @min-[520px]:mt-4 @min-[520px]:w-full">
                  <span className="block text-[14px] leading-5 font-medium text-foreground">
                    {label}
                  </span>
                  <span className="mt-1.5 block max-w-[34ch] text-[12px] leading-[1.55] text-pretty text-muted-foreground">
                    {description}
                  </span>
                </span>
              </button>
            )
          )}
        </div>
      </div>
    </section>
  )
}
