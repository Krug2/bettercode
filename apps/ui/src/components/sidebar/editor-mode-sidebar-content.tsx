import { EditorOpenEditorsList, EditorRecentFilesList } from "./editor-file-lists"
import { lazy, Suspense, useState } from "react"
import {
  FileDiffIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HashIcon,
  LayoutGridIcon,
  ListTreeIcon,
  SearchCodeIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErrorBoundary } from "@/components/error-boundary"
import { GitPanel } from "@/components/git-panel"
import { EditorCodeMapView } from "@/components/sidebar/editor-code-map-view"
import { EditorSearchSidebarView } from "./editor-search-view"
import { EditorReferencesView } from "@/components/sidebar/editor-references-view"
import { ProjectFileTree } from "@/components/file-tree/project-file-tree"
import { useEditorStore } from "@/lib/editor-store"
import {
  buildCodeOutline,
  selectCurrentOutlinePath,
  type CodeOutlineItem,
} from "@/lib/code-outline"
import { openSourceTarget } from "@/lib/source-opener"
import { cn } from "@/lib/utils"
import { usePreferencesStore, type EditorSidebarView } from "@/lib/preferences-store"
import type { UiProvider } from "@/lib/provider-types"
import { setDiffViewOpen } from "@/lib/diff-view"

const DiffPanel = lazy(() =>
  import("@/components/diff-panel").then((module) => ({
    default: module.DiffPanel,
  }))
)

/**
 * Editor-mode left sidebar content. VS-Code-style view switch:
 * ONE view fills the entire sidebar body at any time, chosen by the
 * ActivityBar icons (Files ↔ Outline ↔ Source Control ↔ Agents). No more
 * stacking with a resize handle — each view gets the full vertical space.
 *
 * - `files` renders the project file tree
 * - `search` renders project-wide code search
 * - `map` renders a codebase structure overview
 * - `problems` renders editor diagnostics from Monaco
 * - `references` renders project references for the selected editor symbol
 * - `outline` renders active-file symbols and sections
 * - `source-control` renders the full git panel
 * - `diff` renders staged and unstaged code changes in the active checkout
 * Multi-agent controls live in the chat composer dropdown, not this
 * VS-Code-style activity sidebar.
 *
 * File clicks route through the editor store so the clicked file opens
 * in the active editor tab; git clicks go through the shared
 * {@link GitPanel}. Rendered by `left-sidebar.tsx` in Editor and Canvas modes
 * with an active project path.
 */
export function EditorModeSidebarContent({
  projectPath,
  projectName,
  view,
  providers: _providers,
}: {
  projectPath: string
  projectName?: string | null
  view: EditorSidebarView
  providers: UiProvider[]
}) {
  const appMode = usePreferencesStore(state => state.appMode)
  const activeDiff = useEditorStore(state => state.tabs.find(tab => tab.id === state.activeTabId)?.diff ?? null)
  const label =
    view === "source-control"
      ? "Source Control"
      : view === "search"
        ? "Search"
        : view === "outline"
          ? "Outline"
          : view === "map"
            ? "Code Map"
            : view === "references"
              ? "References"
              : "Explorer"
  const folderName = projectName?.trim() || basename(projectPath) || "Project"

  if (view === "diff") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={FileDiffIcon}
          label="Diff"
          title={folderName}
          path={projectPath}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary key={projectPath} label="Diff">
            <Suspense
              fallback={
                <p role="status" className="p-3 text-xs text-muted-foreground">
                  Loading changes…
                </p>
              }
            >
              <DiffPanel
                open
                cwd={projectPath}
                onClose={() => setDiffViewOpen(false)}
                selectedDiff={activeDiff}
                onSelectDiff={appMode === "editor" ? (target, preview) => useEditorStore.getState().openDiff(target, { preview }) : undefined}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  if (view === "outline") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={ListTreeIcon}
          label={label}
          title={folderName}
          path={projectPath}
        />
        <EditorOutlineSidebarView />
      </div>
    )
  }

  if (view === "search") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={SearchIcon}
          label={label}
          title={folderName}
          path={projectPath}
        />
        <EditorSearchSidebarView projectPath={projectPath} />
      </div>
    )
  }

  if (view === "map") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={LayoutGridIcon}
          label={label}
          title={folderName}
          path={projectPath}
        />
        <EditorCodeMapView key={projectPath} projectPath={projectPath} />
      </div>
    )
  }

  if (view === "references") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={SearchCodeIcon}
          label={label}
          title={folderName}
          path={projectPath}
        />
        <EditorReferencesView projectPath={projectPath} />
      </div>
    )
  }

  if (view === "source-control") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <EditorSidebarHeader
          icon={GitBranchIcon}
          label={label}
          title={folderName}
          path={projectPath}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ErrorBoundary label="Git">
            <GitPanel cwd={projectPath} appMode="editor" diffTabs={appMode === "editor"} />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  // Default view: files (project explorer)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorOpenEditorsList projectPath={projectPath} />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border/60 p-1.5">
        <ProjectFileTree
          completeRootListing
          projectPath={projectPath}
          defaultOpen
          openStorageKey="betterc0de-editor-section:workspace"
          onFileSelect={(relPath, options) => {
            void openSourceTarget(
              { kind: "file", filePath: relPath },
              {
                workspacePath: projectPath,
                preview: options?.preview === true,
              }
            )
          }}
        />
      </div>
      <EditorRecentFilesList projectPath={projectPath} />
    </div>
  )
}

function EditorOutlineSidebarView() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const [query, setQuery] = useState("")
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const outline =
    activeTab
        ? buildCodeOutline({
            content: activeTab.content,
            language: activeTab.language ?? "plaintext",
            fileName: activeTab.fileName,
          })
      : []
  const currentOutlineIds = new Set(
    activeTab
      ? selectCurrentOutlinePath(outline, activeTab.cursorLine).map(
          (entry) => entry.id
        )
      : []
  )
  const term = query.trim().toLowerCase()
  const filtered = term
    ? outline.filter(
        (entry) =>
          entry.name.toLowerCase().includes(term) ||
          entry.kind.toLowerCase().includes(term) ||
          entry.detail?.toLowerCase().includes(term)
      )
    : outline

  const jumpToSymbol = (entry: CodeOutlineItem) => {
    if (!activeTab) return
    setActiveTab(activeTab.id)
    window.dispatchEvent(
      new CustomEvent("betterc0de:editor-goto-line", {
        detail: {
          filePath: activeTab.filePath,
          line: entry.line,
          column: entry.column,
        },
      })
    )
  }

  if (!activeTab) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
        <div className="border-y border-sidebar-border/55 py-2">
          <div className="flex items-center gap-1.5">
            <ListTreeIcon className="size-3.5 text-muted-foreground" />
            <p className="text-[11px] font-medium text-sidebar-foreground">
              No active file
            </p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Open a source file to show symbols.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-sidebar-border/60 p-2">
        <div className="rounded-md border border-sidebar-border/60 bg-sidebar-accent/18 px-2 py-1.5">
          <p className="truncate text-xs font-medium text-sidebar-foreground">
            {activeTab.fileName}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {activeTab.language}
          </p>
        </div>
        <label className="mt-2 flex h-7 items-center gap-2 rounded-md border border-sidebar-border/60 bg-sidebar/45 px-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter symbols"
            className="min-w-0 flex-1 bg-transparent text-xs text-sidebar-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <HashIcon className="size-5 text-muted-foreground/55" />
            <p className="mt-2 text-xs text-muted-foreground">
              {outline.length === 0
                ? "No outline symbols found for this file."
                : "No matching symbols."}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => jumpToSymbol(entry)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/55 focus-visible:bg-sidebar-accent focus-visible:outline-none",
                  currentOutlineIds.has(entry.id) &&
                    "bg-primary/10 ring-1 ring-primary/20"
                )}
                style={{ paddingLeft: `${8 + entry.depth * 10}px` }}
              >
                <OutlineKindIcon kind={entry.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-sidebar-foreground">
                    {entry.name}
                  </span>
                  {entry.detail && (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                      {entry.detail}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/55">
                  {entry.line}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EditorModeSidebarEmptyState({
  onOpenFolder,
  onSearchProjects,
}: {
  onOpenFolder: () => void
  onSearchProjects: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorSidebarHeader
        icon={FolderOpenIcon}
        label="Explorer"
        title="No folder open"
        path="Open a project folder to explore its files."
      />
      <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
        <div className="rounded border border-sidebar-border/60 bg-sidebar-accent/20 px-2 py-1.5">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
            Workspace
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-sidebar-foreground">
            No folder selected
          </p>
        </div>

        <div className="mt-2 grid gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group h-7 w-full justify-between rounded px-2 text-[11px] font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={onOpenFolder}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-sidebar-foreground" />
              <span className="truncate">Open Folder</span>
            </span>
            <span className="rounded bg-sidebar-accent/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              Open
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group h-7 w-full justify-between rounded px-2 text-[11px] font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={onSearchProjects}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-sidebar-foreground" />
              <span className="truncate">Search Projects</span>
            </span>
            <span className="rounded bg-sidebar-accent/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              Ctrl F
            </span>
          </Button>
        </div>

        <div className="mt-auto border-t border-sidebar-border/60 px-1.5 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Files, source control, terminal sessions, and agent tasks attach to
            the selected folder.
          </p>
        </div>
      </div>
    </div>
  )
}

function EditorSidebarHeader({
  icon: Icon,
  label,
  title,
  path,
}: {
  icon: LucideIcon
  label: string
  title: string
  path: string
}) {
  return (
    // Panel title first (VS Code convention), workspace name second and
    // dimmed. It used to be the other way round, which made the section
    // label look like a stray tag floating on the right — and put the
    // folder name in direct competition with the file tree's own header
    // one row below.
    <div
      className="flex h-10 shrink-0 items-center gap-2 px-4"
      title={path}
    >
      <Icon
        className="size-3.5 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
      />
      <span className="shrink-0 text-xs font-medium text-sidebar-foreground">
        {label}
      </span>
      <p className="sr-only">
        {title}
      </p>
    </div>
  )
}

function OutlineKindIcon({ kind }: { kind: CodeOutlineItem["kind"] }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border font-mono text-[9px] font-semibold",
        outlineKindClass(kind)
      )}
      aria-hidden
    >
      {outlineKindLabel(kind)}
    </span>
  )
}

function outlineKindLabel(kind: CodeOutlineItem["kind"]): string {
  switch (kind) {
    case "class":
      return "C"
    case "component":
      return "R"
    case "function":
      return "F"
    case "method":
      return "M"
    case "interface":
      return "I"
    case "type":
      return "T"
    case "enum":
      return "E"
    case "module":
      return "P"
    case "section":
      return "#"
    case "selector":
      return "."
    case "key":
      return "K"
  }
}

function outlineKindClass(kind: CodeOutlineItem["kind"]): string {
  switch (kind) {
    case "class":
    case "component":
      return "border-blue-500/25 bg-blue-500/10 text-blue-300"
    case "function":
    case "method":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
    case "interface":
    case "type":
    case "enum":
      return "border-amber-500/25 bg-amber-500/10 text-amber-300"
    case "section":
    case "selector":
    case "key":
    case "module":
      return "border-sidebar-border/70 bg-sidebar-accent/35 text-muted-foreground"
  }
}

function basename(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? ""
}
