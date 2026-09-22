import { ChartNoAxesColumnIcon, CircleIcon, FolderPlusIcon, GitBranchIcon, GlobeIcon, MessageSquareIcon, PlusIcon, StickyNoteIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { WorkspaceKind } from "@/lib/canvas-workspace"

export const workspaceChoices = [
  { kind: "browser", label: "Browser", icon: GlobeIcon },
  { kind: "browser", label: "GitHub", icon: GitBranchIcon, url: "https://github.com" },
  { kind: "usage", label: "Usage blobs", icon: CircleIcon },
  { kind: "activity", label: "Usage charts", icon: ChartNoAxesColumnIcon },
  { kind: "note", label: "Note", icon: StickyNoteIcon },
  { kind: "chat", label: "Chat", icon: MessageSquareIcon },
] satisfies { kind: WorkspaceKind; label: string; icon: typeof GlobeIcon; url?: string }[]

export function WorkspaceAddMenu({ onAdd, onProject }: { onAdd: (kind: WorkspaceKind, url?: string) => void; onProject?: () => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium hover:bg-muted"><PlusIcon size={14} />Add window</button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-48">
      {workspaceChoices.map(choice => <DropdownMenuItem key={choice.label} onSelect={() => onAdd(choice.kind, choice.url)}><choice.icon size={15} />{choice.label}</DropdownMenuItem>)}
      {onProject && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onProject}><FolderPlusIcon size={15} />Project preview</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>
}
