import { useState, useMemo, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MessageResponse } from "@/components/ai-elements/message"
import { useAppearanceStore } from "@/lib/appearance-store"
import {
  buildBetterC0dePlanJson,
  parseBetterC0dePlanJson,
  unwrapPlanContent,
  type ParsedPlan,
  type PlanSection,
  type PlanStep,
} from "@/lib/plan-content"
import { cn } from "@/lib/utils"
import {
  CheckIcon,
  ChevronDownIcon,
  LinkIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

function extractLinksFromText(text: string): { text: string; href: string }[] {
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  const plainUrlRegex = /https?:\/\/[^\s)\]]+/g
  const links: { text: string; href: string }[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = markdownLinkRegex.exec(text))) {
    const href = match[2].trim()
    if (!href || seen.has(href)) continue
    seen.add(href)
    links.push({ text: match[1].trim() || href, href })
  }

  while ((match = plainUrlRegex.exec(text))) {
    const href = match[0].trim()
    if (!href || seen.has(href)) continue
    seen.add(href)
    links.push({ text: href, href })
  }

  return links
}

function stripInlineLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/https?:\/\/[^\s)\]]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd()
}

function cleanTaskText(raw: string): string {
  const withoutLinks = stripInlineLinks(raw)
  const withoutImageTag = withoutLinks.replace(/\[Image\s*\d+\]/gi, "")
  const withoutMarkdown = withoutImageTag
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")

  return withoutMarkdown.replace(/\s{2,}/g, " ").trim()
}

function splitTaskTag(raw: string): { tag: string | null; text: string } {
  const match = raw.match(/^\[([^\]]+)\]\s*(.+)$/)
  if (!match) return { tag: null, text: raw }
  return { tag: match[1].trim(), text: match[2].trim() }
}

function extractNumberedTaskText(raw: string): string | null {
  const normalized = raw
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .trim()
  const match = normalized.match(/^\d+[.)]\s+(.+)$/)
  if (!match) return null
  const text = cleanTaskText(match[1])
  if (!text || text.length > 180) return null
  return text
}

function isGenericTaskSection(sectionName: string): boolean {
  const normalized = sectionName.trim().toLowerCase()
  return [
    "tasks",
    "todos",
    "tasks / todos",
    "tasks/todos",
    "task",
    "todo",
  ].includes(normalized)
}

function isTaskSectionName(sectionName: string): boolean {
  const normalized = sectionName.trim().toLowerCase().replace(/\s+/g, " ")
  return (
    normalized.includes("task") ||
    normalized.includes("todo") ||
    normalized.includes("checklist") ||
    normalized.includes("action item") ||
    normalized.includes("aufgabe")
  )
}

function formatPreviewLine(line: string): string {
  const stripped = stripInlineLinks(line)
    .replace(/\[Image\s*\d+\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd()

  const taggedMatch = stripped.match(/^\[([^\]]+)\]\s*(.+)$/)
  if (!taggedMatch) return stripped

  const tag = taggedMatch[1].trim()
  const text = taggedMatch[2].trim()
  return text ? `**${tag}** ${text}` : `**${tag}**`
}

function buildPlanPreviewContent(text: string): string {
  const lines = text.split("\n")
  const normalized: string[] = []
  let inTaskSection = false

  for (const line of lines) {
    const headingMatch = line.trim().match(/^#{2,3}\s+(.+)$/)
    if (headingMatch) {
      const sectionName = headingMatch[1].replace(/\*\*/g, "").trim()
      inTaskSection = isTaskSectionName(sectionName)
      if (!inTaskSection) {
        normalized.push(formatPreviewLine(line))
      }
      continue
    }

    const checklistMatch = line.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+)$/)
    if (checklistMatch) {
      if (inTaskSection) {
        continue
      }

      const cleanedTask = cleanTaskText(checklistMatch[1])
      if (!cleanedTask) continue
      normalized.push(formatPreviewLine(cleanedTask))
      continue
    }

    if (inTaskSection) {
      continue
    }

    if (!line.trim()) {
      normalized.push("")
      continue
    }

    normalized.push(formatPreviewLine(line))
  }

  return normalized
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * The dialog header already renders the plan title, so a preview that opens
 * with the same `# Title` heading prints it twice. Drop the leading heading
 * when it restates the title (both markdown and JSON plans hit this).
 */
function stripDuplicateTitleHeading(preview: string, title: string): string {
  const trimmed = preview.trimStart()
  const heading = trimmed.match(/^#\s+(.+?)\s*(?:\n|$)/)
  if (!heading) return preview

  const normalize = (value: string) =>
    value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase()
  if (normalize(heading[1]) !== normalize(title)) return preview

  return trimmed.slice(heading[0].length).trimStart()
}

/** Parse markdown plan format (checkbox tasks only) */
function parsePlan(text: string): ParsedPlan {
  const planText = unwrapPlanContent(text)
  const jsonPlan = parseBetterC0dePlanJson(planText)
  if (jsonPlan) return jsonPlan

  const lines = planText.split("\n")
  let title = "Plan"
  const sections: PlanSection[] = []
  let currentSection: PlanSection | null = null
  let inTaskSection = false
  let hasSeenSectionHeading = false
  let fallbackTaskSection: PlanSection | null = null
  const introLines: string[] = []
  const links: { text: string; href: string }[] = []
  const seenLinks = new Set<string>()

  function collectLinks(source: string) {
    for (const link of extractLinksFromText(source)) {
      if (seenLinks.has(link.href)) continue
      seenLinks.add(link.href)
      links.push(link)
    }
  }

  function ensureSection(name: string) {
    if (!currentSection || currentSection.name !== name) {
      currentSection = { name, steps: [] }
      sections.push(currentSection)
    }
    return currentSection
  }

  function ensureFallbackTaskSection(name = "Tasks") {
    if (!fallbackTaskSection) {
      fallbackTaskSection = { name, steps: [] }
      sections.push(fallbackTaskSection)
    }
    return fallbackTaskSection
  }

  function appendTask(section: PlanSection, rawText: string, done = false) {
    const cleanedTask = cleanTaskText(rawText)
    if (!cleanedTask) return
    section.steps.push({
      id: crypto.randomUUID(),
      text: cleanedTask,
      done,
    })
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    collectLinks(trimmed)

    if (
      trimmed.startsWith("# ") &&
      !trimmed.startsWith("## ") &&
      !trimmed.startsWith("### ")
    ) {
      title = trimmed.slice(2).trim().replace(/\*\*/g, "")
      continue
    }

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      hasSeenSectionHeading = true
      const name = trimmed
        .replace(/^#{2,3}\s+/, "")
        .replace(/\*\*/g, "")
        .trim()

      inTaskSection = isTaskSectionName(name)
      if (inTaskSection) {
        currentSection = { name: name || "Tasks", steps: [] }
        sections.push(currentSection)
      } else {
        const numberedHeadingTask = extractNumberedTaskText(name)
        if (numberedHeadingTask) {
          appendTask(ensureFallbackTaskSection(), numberedHeadingTask)
        }
        currentSection = null
      }
      continue
    }

    const checkMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/)
    if (checkMatch) {
      if (!inTaskSection) {
        if (hasSeenSectionHeading) {
          continue
        }
        fallbackTaskSection = ensureFallbackTaskSection()
      }

      const sec = inTaskSection
        ? currentSection || ensureSection("Tasks")
        : fallbackTaskSection || ensureFallbackTaskSection()
      appendTask(sec, checkMatch[2], checkMatch[1].toLowerCase() === "x")
      continue
    }

    const numberedTask = extractNumberedTaskText(trimmed)
    if (numberedTask) {
      appendTask(
        inTaskSection
          ? currentSection || ensureSection("Tasks")
          : ensureFallbackTaskSection(),
        numberedTask
      )
      continue
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (bulletMatch && inTaskSection) {
      appendTask(currentSection || ensureSection("Tasks"), bulletMatch[1])
      continue
    }

    if (!currentSection) {
      introLines.push(trimmed)
    }
  }

  const description = introLines.join(" ").slice(0, 300)
  const normalizedSections = sections.filter(
    (section) => section.steps.length > 0
  )

  return {
    title,
    description,
    sections: normalizedSections,
    links,
    previewContent: buildPlanPreviewContent(planText),
    rawContent: text,
  }
}

/**
 * Compact completion ring for the modal header. Reads as a single glanceable
 * "how far along is this checklist" mark instead of the old number + bar +
 * percent triplet that competed with the title for attention.
 */
function PlanProgressRing({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const radius = 13.5
  const circumference = 2 * Math.PI * radius

  return (
    <div
      className={cn(
        "relative grid size-10 shrink-0 place-items-center",
        className
      )}
      role="img"
      aria-label={`${value}% of checklist complete`}
    >
      <svg viewBox="0 0 32 32" className="size-10 -rotate-90">
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-border"
        />
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (circumference * value) / 100}
          className="text-success transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-[9.5px] leading-none font-semibold tabular-nums">
        {value}
        <span className="text-[7px] font-medium text-muted-foreground">%</span>
      </span>
    </div>
  )
}

/** Checkbox mark used by the checklist rows — square-rounded, fills on done. */
function PlanTaskCheck({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[6px] border transition-all duration-150",
        done
          ? "border-success bg-success text-background"
          : "border-muted-foreground/40 group-hover/task:border-muted-foreground/70"
      )}
    >
      <CheckIcon
        strokeWidth={3}
        className={cn(
          "size-2.5 transition-opacity",
          done ? "opacity-100" : "opacity-0"
        )}
      />
    </span>
  )
}

/** Full plan modal with checklist editing */
export function PlanModal({
  open,
  onClose,
  content,
  onExecute,
  onExecuteInNewThread,
  executeDisabled = false,
  executeLabel = "Execute Plan",
}: {
  open: boolean
  onClose: () => void
  content: string
  onExecute?: (planContent: string) => void
  onExecuteInNewThread?: (planContent: string) => void
  executeDisabled?: boolean
  executeLabel?: string
}) {
  const isSimple = useAppearanceStore((s) => s.chatUiStyle === "simple")
  const parsed = useMemo(() => parsePlan(content), [content])
  const [sections, setSections] = useState(parsed.sections)
  const [newStepText, setNewStepText] = useState("")
  const [activeSection, setActiveSection] = useState(
    parsed.sections[0]?.name || "Tasks"
  )
  const [editingTask, setEditingTask] = useState<{
    sectionName: string
    stepId: string
  } | null>(null)
  const [editingTaskText, setEditingTaskText] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<{
    sectionName: string
    stepId: string
    text: string
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setSections(parsed.sections)
    setActiveSection(parsed.sections[0]?.name || "Tasks")
    setNewStepText("")
    setEditingTask(null)
    setEditingTaskText("")
    setDeleteTarget(null)
  }, [open, parsed])

  const addStep = () => {
    if (!newStepText.trim()) return
    setSections((prev) => {
      const exists = prev.find((s) => s.name === activeSection)
      if (exists) {
        return prev.map((sec) =>
          sec.name === activeSection
            ? {
                ...sec,
                steps: [
                  ...sec.steps,
                  {
                    id: crypto.randomUUID(),
                    text: newStepText.trim(),
                    done: false,
                  },
                ],
              }
            : sec
        )
      }
      return [
        ...prev,
        {
          name: activeSection,
          steps: [
            { id: crypto.randomUUID(), text: newStepText.trim(), done: false },
          ],
        },
      ]
    })
    setNewStepText("")
  }

  const toggleStep = (sectionName: string, stepId: string) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.name !== sectionName) return section
        return {
          ...section,
          steps: section.steps.map((step) =>
            step.id === stepId ? { ...step, done: !step.done } : step
          ),
        }
      })
    )
  }

  const startEditTask = (sectionName: string, step: PlanStep) => {
    setEditingTask({ sectionName, stepId: step.id })
    setEditingTaskText(step.text)
  }

  const cancelEditTask = () => {
    setEditingTask(null)
    setEditingTaskText("")
  }

  const saveEditTask = () => {
    if (!editingTask) return
    const nextText = cleanTaskText(editingTaskText)
    if (!nextText) return

    setSections((prev) =>
      prev.map((section) => {
        if (section.name !== editingTask.sectionName) return section
        return {
          ...section,
          steps: section.steps.map((step) =>
            step.id === editingTask.stepId ? { ...step, text: nextText } : step
          ),
        }
      })
    )

    cancelEditTask()
  }

  const requestDeleteTask = (sectionName: string, step: PlanStep) => {
    setDeleteTarget({ sectionName, stepId: step.id, text: step.text })
  }

  const confirmDeleteTask = () => {
    if (!deleteTarget) return

    setSections((prev) =>
      prev.map((section) => {
        if (section.name !== deleteTarget.sectionName) return section
        return {
          ...section,
          steps: section.steps.filter(
            (step) => step.id !== deleteTarget.stepId
          ),
        }
      })
    )

    if (
      editingTask &&
      editingTask.sectionName === deleteTarget.sectionName &&
      editingTask.stepId === deleteTarget.stepId
    ) {
      cancelEditTask()
    }

    setDeleteTarget(null)
  }

  const totalSteps = sections.reduce((sum, sec) => sum + sec.steps.length, 0)
  const doneSteps = sections.reduce(
    (sum, sec) => sum + sec.steps.filter((step) => step.done).length,
    0
  )
  const pct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0

  const flatTasks = sections.flatMap((sec) =>
    sec.steps.map((step) => ({ ...step, section: sec.name }))
  )

  const sectionOptions = useMemo(() => {
    const names = Array.from(
      new Set(sections.map((section) => section.name.trim()).filter(Boolean))
    )
    if (names.length === 0) names.push("Tasks")
    if (activeSection && !names.includes(activeSection))
      names.push(activeSection)
    return names
  }, [sections, activeSection])

  const buildCurrentPlanContent = () => {
    const serializableSections = sections
      .map((section) => ({
        name: section.name,
        steps: section.steps.map((step) => ({
          id: step.id,
          text: step.text,
          completed: step.done,
        })),
      }))
      .filter((section) => section.steps.some((step) => step.text.trim()))

    if (serializableSections.length === 0) {
      return unwrapPlanContent(content).trim()
    }

    return buildBetterC0dePlanJson({
      title: parsed.title,
      description: parsed.description,
      sections: serializableSections,
      links: parsed.links,
    })
  }

  if (!open) return null

  const hasTasks = totalSteps > 0
  const sectionCount = sections.filter((sec) => sec.steps.length > 0).length
  const metaLabel = hasTasks
    ? [
        `${doneSteps} of ${totalSteps} done`,
        sectionCount > 1 ? `${sectionCount} sections` : null,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "No tracked tasks — run it as written or add steps"
  const showSectionPicker = sectionOptions.length > 1
  const previewBody = stripDuplicateTitleHeading(
    parsed.previewContent,
    parsed.title
  )

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={cn(
            // `gap-0` + `p-0`: the dialog primitive ships a 6-unit grid gap and
            // padding meant for simple prose dialogs — this one owns its own
            // header/body/footer rhythm.
            "flex flex-col gap-0 overflow-hidden p-0 shadow-2xl",
            isSimple
              ? "h-[min(78vh,720px)] sm:max-w-3xl"
              : "h-[min(86vh,860px)] sm:max-w-5xl"
          )}
        >
          <DialogTitle className="sr-only">{parsed.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Plan checklist
          </DialogDescription>

          {/* ── Header — icon tile · title + state badge · progress ring ──
              The old header echoed the plan's opening paragraph, which the
              body already renders in full. It's dropped: the title carries
              identity, the meta line carries status. */}
          <header
            className={cn(
              "flex shrink-0 items-center gap-3 border-b border-border/40",
              isSimple ? "px-4 py-3" : "px-5 py-4"
            )}
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/50 bg-muted/40 text-muted-foreground">
              <ListChecksIcon className="size-4" strokeWidth={2} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2
                  className={cn(
                    "truncate font-semibold tracking-tight",
                    isSimple ? "text-sm" : "text-[15px]"
                  )}
                >
                  {parsed.title}
                </h2>
                <span
                  className={cn(
                    "hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold tracking-[0.14em] uppercase sm:inline-flex",
                    executeDisabled
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border/50 bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      executeDisabled ? "bg-success" : "bg-muted-foreground/60"
                    )}
                  />
                  {executeDisabled ? "Implemented" : "Ready"}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {metaLabel}
              </p>
            </div>

            {hasTasks && (
              <PlanProgressRing value={pct} className="hidden sm:grid" />
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close plan"
              className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </header>

          {/* ── Body — split view. Below `lg` (and in simple mode) the two
              panes stack inside one scroll container; at `lg` each pane owns
              its own scroll so the checklist stays reachable while reading a
              long plan. No nested card chrome: a single divider does the
              separating work the old boxes-inside-boxes did. */}
          <div
            className={cn(
              "plan-modal-scroll flex min-h-0 flex-1 flex-col overflow-y-auto",
              !isSimple &&
                "lg:grid lg:grid-cols-[minmax(0,1fr)_352px] lg:overflow-hidden"
            )}
          >
            <section
              className={cn(
                // The `lg:` scroll container is gated on `!isSimple` for the
                // same reason the grid is: simple mode always stacks, and an
                // unguarded `lg:overflow-y-auto` turned this pane into a
                // second scroll area that clipped the plan mid-sentence.
                "plan-modal-scroll min-w-0",
                !isSimple && "lg:overflow-y-auto",
                isSimple ? "px-4 py-3.5" : "px-6 py-5"
              )}
            >
              <div
                className={cn(
                  "plan-preview-prose max-w-[78ch] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                  isSimple ? "text-xs" : "text-[13px]"
                )}
              >
                {previewBody ? (
                  <MessageResponse>{previewBody}</MessageResponse>
                ) : (
                  <p className="text-muted-foreground">
                    No narrative preview was provided. Use the checklist to
                    shape the execution handoff.
                  </p>
                )}
              </div>

              {parsed.links.length > 0 && (
                <div className="mt-6 border-t border-border/40 pt-4">
                  <p className="mb-2.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Links
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {parsed.links.map((link) => (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-[38ch] items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
                        >
                          <LinkIcon className="size-3 shrink-0" />
                          <span className="truncate">{link.text}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <aside
              className={cn(
                "flex min-w-0 flex-col border-t border-border/40 bg-card/25",
                !isSimple && "lg:min-h-0 lg:border-t-0 lg:border-l"
              )}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    Checklist
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    {hasTasks
                      ? `${doneSteps}/${totalSteps} completed`
                      : "Optional execution tracking"}
                  </p>
                </div>
                {hasTasks && (
                  <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-success transition-[width] duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>

              {flatTasks.length > 0 ? (
                // Only the `lg` split view gives the list its own scroll
                // container. Stacked, the whole body is already one scroll
                // area — a second one nested inside it means two scrollbars
                // fighting over the same gesture.
                <div
                  className={cn(
                    "plan-tasks-scroll space-y-0.5 px-2 pb-2",
                    !isSimple && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                  )}
                >
                  {flatTasks.map((task) => {
                    const taggedTask = splitTaskTag(task.text)
                    const displayTaskText = taggedTask.text || task.text
                    const showSectionChip =
                      !isGenericTaskSection(task.section) &&
                      taggedTask.tag?.toLowerCase() !==
                        task.section.toLowerCase()
                    const isEditing =
                      editingTask?.sectionName === task.section &&
                      editingTask?.stepId === task.id

                    return (
                      <div
                        key={task.id}
                        className="group/task flex items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-border/45 hover:bg-muted/25"
                      >
                        <button
                          type="button"
                          onClick={() => toggleStep(task.section, task.id)}
                          className="mt-px shrink-0 rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          aria-pressed={task.done}
                          aria-label={
                            task.done
                              ? "Mark task as not done"
                              : "Mark task as done"
                          }
                        >
                          <PlanTaskCheck done={task.done} />
                        </button>

                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <Input
                              autoFocus
                              value={editingTaskText}
                              onChange={(e) =>
                                setEditingTaskText(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditTask()
                                if (e.key === "Escape") cancelEditTask()
                              }}
                              className="h-7 rounded-lg border border-border bg-background/70 text-xs"
                            />
                          ) : (
                            // Chips run inline with the label instead of on
                            // their own line — a six-item checklist was twice
                            // as tall as it needed to be.
                            <span
                              className={cn(
                                "block text-xs leading-relaxed text-foreground/90 transition-colors",
                                task.done &&
                                  "text-muted-foreground/70 line-through decoration-muted-foreground/40"
                              )}
                            >
                              {taggedTask.tag && (
                                <span className="mr-1.5 rounded-md bg-primary/10 px-1.5 py-px align-[1px] text-[9.5px] font-semibold tracking-wide text-primary uppercase no-underline">
                                  {taggedTask.tag}
                                </span>
                              )}
                              {displayTaskText}
                              {showSectionChip && (
                                <span className="ml-1.5 rounded-md bg-muted/70 px-1.5 py-px align-[1px] text-[9.5px] font-medium text-muted-foreground no-underline">
                                  {task.section}
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Actions stay out of the way until the row is
                            hovered/focused — the list reads as content, not
                            as a toolbar grid. */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/task:opacity-100 focus-within:opacity-100">
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={saveEditTask}
                                disabled={!editingTaskText.trim()}
                                className="rounded-full text-success hover:text-success"
                                aria-label="Save task"
                              >
                                <CheckIcon className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={cancelEditTask}
                                className="rounded-full"
                                aria-label="Cancel task edit"
                              >
                                <XIcon className="size-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() =>
                                  startEditTask(task.section, task)
                                }
                                className="rounded-full text-muted-foreground hover:text-foreground"
                                aria-label="Edit task"
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() =>
                                  requestDeleteTask(task.section, task)
                                }
                                className="rounded-full text-muted-foreground hover:text-destructive"
                                aria-label="Delete task"
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className={cn("px-4 pb-4", !isSimple && "lg:flex-1")}>
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 px-4 py-6 text-center">
                    <ListChecksIcon
                      className="mb-2 size-5 text-muted-foreground/40"
                      strokeWidth={1.75}
                    />
                    <p className="text-xs font-medium text-foreground/85">
                      No tracked tasks
                    </p>
                    <p className="mt-1 max-w-[30ch] text-[11px] leading-relaxed text-muted-foreground">
                      This plan has no checklist. Add steps below to track them
                      during execution.
                    </p>
                  </div>
                </div>
              )}

              {/* Composer pinned to the bottom of the pane. The section
                  picker only appears when there is more than one section to
                  choose between — otherwise it was a dropdown with a single
                  option taking a full row. */}
              <div className="mt-auto shrink-0 space-y-2 border-t border-border/35 px-3 py-3">
                {showSectionPicker && (
                  <Select
                    value={activeSection}
                    onValueChange={setActiveSection}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-full rounded-full border-border/60 bg-background/50 text-[11px]"
                    >
                      <SelectValue placeholder="Choose section" />
                    </SelectTrigger>
                    <SelectContent>
                      {sectionOptions.map((sectionName) => (
                        <SelectItem key={sectionName} value={sectionName}>
                          {sectionName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/50 py-1 pr-1 pl-3.5 transition-colors focus-within:border-ring/60 focus-within:bg-background/80">
                  <input
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addStep()}
                    placeholder="Add a task…"
                    aria-label="Add a task"
                    className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    onClick={addStep}
                    disabled={!newStepText.trim()}
                    aria-label="Add task"
                    className="size-6 rounded-full"
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            </aside>
          </div>

          {/* ── Footer ── */}
          <footer
            className={cn(
              "flex shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-card/20",
              isSimple ? "px-4 py-2.5" : "px-5 py-3.5"
            )}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              Close
            </Button>

            {onExecute && (
              <div className="flex items-center">
                <Button
                  size="sm"
                  className={cn(
                    "gap-1.5 px-4 shadow-sm",
                    onExecuteInNewThread && !executeDisabled && "rounded-r-none"
                  )}
                  disabled={executeDisabled}
                  onClick={() => onExecute(buildCurrentPlanContent())}
                >
                  {executeDisabled ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <PlayIcon className="size-3.5" />
                  )}
                  {executeLabel}
                </Button>
                {onExecuteInNewThread && !executeDisabled ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        className="rounded-l-none border-l border-primary-foreground/20 px-2 shadow-sm"
                        aria-label="Implementation actions"
                      >
                        <ChevronDownIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top">
                      <DropdownMenuItem
                        onClick={() =>
                          onExecuteInNewThread(buildCurrentPlanContent())
                        }
                      >
                        Implement in a new thread
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            )}
          </footer>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleteTarget(null)
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Task?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {deleteTarget?.text}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteTask}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
