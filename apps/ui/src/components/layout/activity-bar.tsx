import {
  FolderOpenIcon,
  GitBranchIcon,
  SearchIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { EditorSidebarView } from "@/lib/preferences-store"

/**
 * Compact VS-Code-style activity bar for editor mode.
 *
 * Keep this deliberately boring: a static icon rail with a left active edge.
 * No hover-follow animation, no marketplace/automation shortcuts, no custom
 * workbench concepts in the primary rail. Secondary views can still be opened
 * through command palette/settings, but the editor chrome stays familiar.
 */
interface ActivityBarProps {
  appMode: "agent" | "editor" | "design"
  sidebarOpen: boolean
  setAppMode: (mode: "agent" | "editor" | "design") => void
  chatSearch: string
  setChatSearch: (q: string) => void
  setGitModal: (open: boolean) => void
  marketplaceOpen: boolean
  setMarketplaceOpen: (open: boolean) => void
  settingsOpen: boolean
  settingsTab: string
  setSettingsTab: (tab: string) => void
  setSettingsOpen: (open: boolean) => void
  setSystemBrowserOpen: (open: boolean) => void
  setSystemBrowserIntent: (
    intent: "agent-new-thread" | "editor-open-folder"
  ) => void
  editorSidebarView: EditorSidebarView
  setEditorSidebarView: (v: EditorSidebarView) => void
  activeProjectPath?: string | null
  gitHubUser?: string
  gitUserName?: string
}

export function ActivityBar({
  appMode,
  sidebarOpen,
  setAppMode,
  chatSearch,
  setChatSearch,
  settingsOpen,
  settingsTab,
  setSettingsTab,
  setSettingsOpen,
  setSystemBrowserOpen,
  setSystemBrowserIntent,
  editorSidebarView,
  setEditorSidebarView,
  activeProjectPath,
}: ActivityBarProps) {
  const isEditor = appMode === "editor"
  const filesActive = isEditor && sidebarOpen && editorSidebarView === "files"
  const searchActive =
    isEditor && sidebarOpen
      ? editorSidebarView === "search"
      : chatSearch.trim().length > 0
  const scmActive =
    isEditor && sidebarOpen && editorSidebarView === "source-control"
  const settingsActive = settingsOpen && settingsTab !== "hooks"

  const openFiles = () => {
    if (!activeProjectPath) {
      setSystemBrowserIntent("editor-open-folder")
      setSystemBrowserOpen(true)
      return
    }
    setEditorSidebarView("files")
    setAppMode("editor")
  }

  return (
    <aside
      aria-label="Activity Bar"
      className="flex w-11 shrink-0 flex-col items-center border-r border-sidebar-border/70 bg-sidebar/95 py-2 shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)] 2xl:w-12"
    >
      <ActivityIcon
        icon={FolderOpenIcon}
        label="Explorer"
        active={filesActive}
        onClick={openFiles}
      />
      <ActivityIcon
        icon={SearchIcon}
        label="Search"
        active={searchActive}
        onClick={() => {
          if (isEditor) {
            setEditorSidebarView("search")
            return
          }
          setChatSearch(" ")
        }}
      />
      <ActivityIcon
        icon={GitBranchIcon}
        label="Source Control"
        active={scmActive}
        onClick={() => {
          setEditorSidebarView("source-control")
          setAppMode("editor")
        }}
      />
      <div className="flex-1" />

      <ActivityIcon
        icon={SettingsIcon}
        label="Settings"
        active={settingsActive}
        onClick={() => {
          setSettingsTab("general")
          setSettingsOpen(true)
        }}
      />
    </aside>
  )
}

interface ActivityIconProps {
  icon: LucideIcon
  label: string
  active?: boolean
  onClick: () => void
}

function ActivityIcon({
  icon: Icon,
  label,
  active = false,
  onClick,
}: ActivityIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-none text-muted-foreground/75 transition-colors duration-100 focus-visible:ring-1 focus-visible:ring-primary/45 focus-visible:outline-none 2xl:size-10",
            active
              ? "bg-sidebar-accent/70 text-sidebar-foreground"
              : "hover:bg-sidebar-accent/45 hover:text-sidebar-foreground"
          )}
        >
          {active && (
            <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-primary" />
          )}
          <Icon
            className="size-[18px] 2xl:size-[21px]"
            strokeWidth={active ? 2 : 1.75}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
