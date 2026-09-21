export interface BetterC0deTip {
  title: string
  command: string
  description: string
}

export const BETTERC0DE_TIPS: BetterC0deTip[] = [
  {
    title: "Plan before edits",
    command: "/plan",
    description: "Use plan mode for read-only implementation planning.",
  },
  {
    title: "Ask without writes",
    command: "/ask",
    description: "Use ask mode when you want analysis without file changes.",
  },
  {
    title: "Review changes",
    command: "/review",
    description: "Review uncommitted changes, branches, commits, or PR context.",
  },
  {
    title: "Inspect project config",
    command: "/betterc0de",
    description: "Show BetterC0de compatibility config loaded for the workspace.",
  },
  {
    title: "Check keybind parity",
    command: "/keybinds",
    description: "Show project keybind overrides and BetterC0de defaults.",
  },
  {
    title: "Save context",
    command: "/stash",
    description: "Stash prompt text and restore it later with /stash-pop.",
  },
  {
    title: "Jump quickly",
    command: "/pin",
    description: "Pin active chats and jump with /quick-switch.",
  },
  {
    title: "Summarize long sessions",
    command: "/compact",
    description: "Compact the current chat into a thread summary.",
  },
  {
    title: "Inspect runtime tools",
    command: "/mcps",
    description: "List runtime and project MCP servers available to the chat.",
  },
  {
    title: "Control diff layout",
    command: "/diff-style",
    description: "Switch diff layout between auto and stacked.",
  },
]

export function buildBetterC0deTipsMarkdown(): string {
  return [
    "# BetterC0de Tips\n",
    "| Tip | Command | Use When |",
    "|:----|:--------|:---------|",
    ...BETTERC0DE_TIPS.map(
      (tip) => `| **${tip.title}** | \`${tip.command}\` | ${tip.description} |`
    ),
    "",
    "> Use `/help` for the full BetterC0de command surface.",
  ].join("\n")
}
