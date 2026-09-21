import { cn } from "@/lib/utils"
import { getFileIconUrl } from "@/lib/file-icons"
import { useAppearanceStore } from "@/lib/appearance-store"
import { PromptInputHeader, usePromptInputController } from "@/components/ai-elements/prompt-input"
import { formatProviderSkillDisplayName } from "@/lib/provider-skill-presentation"
import type { ProviderSkill } from "@betterc0de/schema"
import { EMPTY_BROWSER_ELEMENTS, useBrowserContextStore } from "@/lib/browser-context-store"
import { maskBrowserMentions } from "@/lib/browser-element-mentions"

type ComposerSkillChip = Pick<ProviderSkill, "name" | "displayName">

export function extractComposerInlineChips(
  text: string,
  skills: ReadonlyArray<ComposerSkillChip>,
): {
  mentions: string[]
  skills: ComposerSkillChip[]
} {
  const mentions = [...text.matchAll(/@([\w./\\-]+)/g)].map((match) => match[1])
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]))
  const skillMatches = [...text.matchAll(/(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g)]
    .map((match) => skillsByName.get(match[2] ?? ""))
    .filter((skill): skill is ComposerSkillChip => Boolean(skill))

  return {
    mentions: [...new Set(mentions)],
    skills: uniqueSkillsByName(skillMatches),
  }
}

function uniqueSkillsByName(
  skills: ReadonlyArray<ComposerSkillChip>,
): ComposerSkillChip[] {
  const out: ComposerSkillChip[] = []
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    out.push(skill)
  }
  return out
}

/**
 * Row of "@file" chips shown above the prompt textarea.
 *
 * Reads this composer's controller, including programmatic draft restores.
 */
export function MentionChips({
  skills = [],
  threadId = null,
}: {
  skills?: ReadonlyArray<ComposerSkillChip>
  threadId?: string | null
}) {
  const { textInput } = usePromptInputController()
  const elements = useBrowserContextStore(state => threadId ? state.byThread[threadId] ?? EMPTY_BROWSER_ELEMENTS : EMPTY_BROWSER_ELEMENTS)
  const { mentions, skills: skillChips } = extractComposerInlineChips(maskBrowserMentions(textInput.value, elements), skills)
  const chatUiStyle = useAppearanceStore((s) => s.chatUiStyle)
  const simple = chatUiStyle === "simple"

  if (mentions.length === 0 && skillChips.length === 0) return null

  return (
    <PromptInputHeader
      className={cn(simple ? "mt-1 ml-0.5 gap-1" : "mt-2 ml-1")}
    >
      {mentions.map((m) => {
        const fileName = m.split("/").pop() || m
        return (
          <span
            key={m}
            className={cn(
              "mention-label gap-1 rounded-full",
              simple &&
                "border-border/60 bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            )}
          >
            <img
              src={getFileIconUrl(fileName)}
              alt=""
              className={cn(simple ? "size-2.5" : "size-3")}
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = "none"
              }}
            />
            {fileName}
          </span>
        )
      })}
      {skillChips.map((skill) => (
        <span
          key={skill.name}
          className={cn(
            "skill-label rounded-full",
            simple &&
              "border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          )}
        >
          {formatProviderSkillDisplayName(skill)}
        </span>
      ))}
    </PromptInputHeader>
  )
}
