import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  StarIcon,
  EyeIcon,
  EyeOffIcon,
  SearchIcon,
  FolderOpenIcon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSystemBrowserState } from "@/hooks/use-system-browser-state"
import { usePreferencesStore } from "@/lib/preferences-store"
import {
  listDirectoryFs,
  searchTreeFs,
  enumerateDrivesFs,
  type DriveEntry,
  type ListEntry,
  type SearchHit,
} from "@/services/backend/filesystem"
import { BreadcrumbPathBar } from "@/components/system-browser/breadcrumb-path-bar"
import { QuickNavSidebar } from "@/components/system-browser/quick-nav-sidebar"
import { FileListVirtual, type VirtualListItem } from "@/components/system-browser/file-list-virtual"

const SEARCH_DEBOUNCE_MS = 200
const LISTBOX_ID = "system-browser-listbox"

interface SystemBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPathPicked: (path: string) => void
  initialPath?: string
}

export function SystemBrowserDialog(props: SystemBrowserDialogProps) {
  const { open, onOpenChange, onPathPicked, initialPath } = props

  const state = useSystemBrowserState()
  const {
    currentPath,
    entries,
    truncated,
    loadState,
    errorMessage,
    searchQuery,
    searchResults,
    searchLoadState,
    searchTookMs,
    showHidden,
    selectedIndex,
    setCurrentPath,
    setEntries,
    setLoadState,
    setSearchQuery,
    setSearchResults,
    setSearchLoadState,
    toggleHidden,
    setSelectedIndex,
    rememberSelection,
    reset,
  } = state

  // Search mode is implicit: any non-empty query → search results;
  // empty query → directory listing.
  const inSearchMode = searchQuery.trim().length > 0

  const favorites = usePreferencesStore((s) => s.favorites)
  const setPreference = usePreferencesStore((s) => s.set)

  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const isFavorite = useCallback((p: string) => favoriteSet.has(p), [favoriteSet])
  const toggleFavoritePath = useCallback(
    (p: string) => {
      const next = favoriteSet.has(p)
        ? favorites.filter((f) => f !== p)
        : [...favorites, p]
      setPreference("favorites", next)
    },
    [favoriteSet, favorites, setPreference],
  )
  const removeFavorite = useCallback(
    (p: string) => {
      setPreference("favorites", favorites.filter((f) => f !== p))
    },
    [favorites, setPreference],
  )

  const [drives, setDrives] = useState<DriveEntry[]>([])
  const [editMode, setEditMode] = useState(false)

  const listAbortRef = useRef<AbortController | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchDebounceRef = useRef<number | null>(null)

  // ── Drives + initial path on open ─────────────────────────────────
  useEffect(() => {
    if (!open) return
    let cancelled = false
    enumerateDrivesFs()
      .then((r) => {
        if (!cancelled) setDrives(r.entries)
      })
      .catch(() => {
        // Drives endpoint failure is non-fatal — user can still type a path.
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (currentPath) return
    if (initialPath) {
      setCurrentPath(initialPath)
      return
    }
    // Default to Documents (typical project parent), then Home, then first
    // reachable drive entry.
    const documents = drives.find(
      (d) => d.kind === "shortcut" && d.label === "Documents",
    )
    if (documents) {
      setCurrentPath(documents.path)
      return
    }
    const home = drives.find((d) => d.kind === "home")
    if (home) {
      setCurrentPath(home.path)
    }
  }, [open, currentPath, initialPath, drives, setCurrentPath])

  // ── Load directory on currentPath change (when NOT searching) ────
  useEffect(() => {
    if (!open || !currentPath || inSearchMode) return
    listAbortRef.current?.abort()
    const ctl = new AbortController()
    listAbortRef.current = ctl
    setLoadState("loading")
    listDirectoryFs(currentPath, { showHidden, signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return
        setEntries(r.entries, r.truncated)
        setLoadState("ready")
        const remembered = state.lastSelectedByDir[currentPath]
        if (remembered) {
          const idx = r.entries.findIndex((e) => e.name === remembered)
          setSelectedIndex(idx >= 0 ? idx : 0)
        } else {
          setSelectedIndex(0)
        }
      })
      .catch((err: Error) => {
        if (ctl.signal.aborted) return
        setEntries([], false)
        setLoadState("error", err.message ?? "Failed to list directory")
      })
    return () => ctl.abort()
    // state.lastSelectedByDir intentionally excluded (snapshot at load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentPath, inSearchMode, showHidden, setEntries, setLoadState, setSelectedIndex])

  // ── Recursive search debounce ─────────────────────────────────────
  useEffect(() => {
    if (!open || !inSearchMode || !currentPath) {
      // Clear stale search state when leaving search mode.
      if (!inSearchMode && (searchResults.length > 0 || searchLoadState !== "idle")) {
        setSearchResults([], 0)
        setSearchLoadState("idle")
      }
      return
    }
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current)
    }
    searchDebounceRef.current = window.setTimeout(() => {
      searchAbortRef.current?.abort()
      const ctl = new AbortController()
      searchAbortRef.current = ctl
      setSearchLoadState("loading")
      searchTreeFs(currentPath, searchQuery, { limit: 1000, signal: ctl.signal })
        .then((r) => {
          if (ctl.signal.aborted) return
          setSearchResults(r.entries, r.tookMs)
          setSearchLoadState("ready")
          setSelectedIndex(0)
        })
        .catch(() => {
          if (ctl.signal.aborted) return
          setSearchResults([], 0)
          setSearchLoadState("error")
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current)
      }
    }
    // searchResults.length / searchLoadState in the cleanup branch are
    // observed through closure; we only re-debounce on the "real" inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    inSearchMode,
    currentPath,
    searchQuery,
    setSearchResults,
    setSearchLoadState,
    setSelectedIndex,
  ])

  // Reset state when dialog closes.
  useEffect(() => {
    if (!open) {
      listAbortRef.current?.abort()
      searchAbortRef.current?.abort()
      reset()
      setEditMode(false)
    }
  }, [open, reset])

  // ── Derive items for the list ─────────────────────────────────────
  const items = useMemo<VirtualListItem[]>(() => {
    if (inSearchMode) {
      return searchResults.map(
        (h: SearchHit): VirtualListItem => ({
          key: h.path,
          name: h.name,
          path: h.path,
          isDir: h.isDir,
          isSymlink: false,
          size: null,
          mtime: null,
          parentHint: parentDir(h.path, currentPath),
        }),
      )
    }
    return entries.map(
      (e: ListEntry): VirtualListItem => ({
        key: e.path,
        name: e.name,
        path: e.path,
        isDir: e.isDir,
        isSymlink: e.isSymlink,
        size: e.size,
        mtime: e.mtime,
      }),
    )
  }, [inSearchMode, entries, searchResults, currentPath])

  const activeItem = items[selectedIndex] ?? null

  // ── Actions ───────────────────────────────────────────────────────
  const navigateTo = useCallback(
    (p: string) => {
      setSearchQuery("")
      setCurrentPath(p)
    },
    [setSearchQuery, setCurrentPath],
  )

  const enterSelection = useCallback(() => {
    if (!activeItem) return
    if (activeItem.isDir) {
      if (currentPath && !inSearchMode) {
        rememberSelection(currentPath, activeItem.name)
      }
      navigateTo(activeItem.path)
    }
  }, [activeItem, currentPath, inSearchMode, rememberSelection, navigateTo])

  const goUp = useCallback(() => {
    if (!currentPath) return
    const sepMatch = /^([A-Za-z]:\\)/.exec(currentPath)
    if (sepMatch && currentPath === sepMatch[1]) return
    if (currentPath === "/") return
    const parent = currentPath.replace(/[\\/][^\\/]*$/, "") || (sepMatch ? sepMatch[1] : "/")
    if (parent === currentPath) return
    navigateTo(parent)
  }, [currentPath, navigateTo])

  const openAsProject = useCallback(() => {
    if (!activeItem || !activeItem.isDir) {
      if (currentPath) onPathPicked(currentPath)
      return
    }
    onPathPicked(activeItem.path)
  }, [activeItem, currentPath, onPathPicked])

  const headerStarActive = currentPath ? favoriteSet.has(currentPath) : false

  // ── Keyboard navigation ───────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && (e.key === "l" || e.key === "L")) {
        e.preventDefault()
        setEditMode(true)
        return
      }
      if (ctrl && (e.key === "h" || e.key === "H")) {
        e.preventDefault()
        toggleHidden()
        return
      }
      if (ctrl && e.key === "Enter") {
        e.preventDefault()
        openAsProject()
        return
      }
      if (ctrl && (e.key === "d" || e.key === "D")) {
        // Ctrl+D = toggle current path as favorite (matches browser bookmark idiom).
        e.preventDefault()
        if (currentPath) toggleFavoritePath(currentPath)
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex(Math.min(items.length - 1, selectedIndex + 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(Math.max(0, selectedIndex - 1))
        return
      }
      if (e.key === "PageDown") {
        e.preventDefault()
        setSelectedIndex(Math.min(items.length - 1, selectedIndex + 10))
        return
      }
      if (e.key === "PageUp") {
        e.preventDefault()
        setSelectedIndex(Math.max(0, selectedIndex - 10))
        return
      }
      if (e.key === "Home") {
        e.preventDefault()
        setSelectedIndex(0)
        return
      }
      if (e.key === "End") {
        e.preventDefault()
        setSelectedIndex(Math.max(0, items.length - 1))
        return
      }
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault()
        enterSelection()
        return
      }
      if (e.key === "Backspace") {
        // Backspace exits search mode if active; otherwise nav up. The path
        // input still owns Backspace inside it via stopPropagation below.
        e.preventDefault()
        if (inSearchMode) {
          setSearchQuery("")
          return
        }
        goUp()
        return
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        if (inSearchMode) {
          setSearchQuery("")
          return
        }
        goUp()
        return
      }
    },
    [
      items.length,
      selectedIndex,
      inSearchMode,
      openAsProject,
      setSelectedIndex,
      enterSelection,
      goUp,
      setSearchQuery,
      toggleHidden,
      currentPath,
      toggleFavoritePath,
    ],
  )

  const totalEntries = inSearchMode ? searchResults.length : entries.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        className={cn(
          // Wide. ~95vw on small viewports, capped at 1320px on monitors.
          "flex h-[85vh] w-[min(1320px,95vw)] max-w-[95vw] flex-col gap-0 overflow-hidden p-0",
          "sm:!max-w-[1320px]",
        )}
      >
        <DialogTitle className="sr-only">System Browser — Open folder</DialogTitle>

        {/* ── Title bar ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border/40 px-4 py-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FolderOpenIcon className="size-4" strokeWidth={1.75} />
          </div>
          <div className="flex flex-1 items-baseline gap-2">
            <h2 className="text-sm font-semibold">Open folder</h2>
            <span className="text-[11px] text-muted-foreground/70">
              Browse and pick a folder to open as a project
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label="Close"
            title="Close (ESC)"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* ── Header row: breadcrumb + favorite + hidden toggle ─────── */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border/40">
          <div className="min-w-0 flex-1">
            <BreadcrumbPathBar
              path={currentPath}
              onNavigate={navigateTo}
              editMode={editMode}
              onRequestEditMode={setEditMode}
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            <button
              type="button"
              onClick={() => currentPath && toggleFavoritePath(currentPath)}
              disabled={!currentPath}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
              aria-label={
                headerStarActive
                  ? "Remove current folder from favorites"
                  : "Add current folder to favorites (Ctrl+D)"
              }
              title={headerStarActive ? "Unfavorite (Ctrl+D)" : "Favorite (Ctrl+D)"}
            >
              <StarIcon
                className={cn(
                  "size-4",
                  headerStarActive && "fill-yellow-500 text-yellow-500",
                )}
              />
            </button>
            <button
              type="button"
              onClick={toggleHidden}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label={showHidden ? "Hide dotfiles (Ctrl+H)" : "Show dotfiles (Ctrl+H)"}
              title={showHidden ? "Hide dotfiles (Ctrl+H)" : "Show dotfiles (Ctrl+H)"}
            >
              {showHidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
            </button>
          </div>
        </div>

        {/* ── Always-visible recursive search ───────────────────────── */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border/40 px-4 py-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground/70" strokeWidth={1.75} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              currentPath
                ? `Recursively search in ${shortenPath(currentPath)}…`
                : "Search files and folders…"
            }
            className={cn(
              "h-8 min-w-0 flex-1 bg-transparent text-sm outline-none",
              "placeholder:text-muted-foreground/40",
            )}
            aria-label="Recursive search within current path"
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                setSearchQuery("")
              }
              if (e.key === "Backspace" && searchQuery.length > 0) {
                e.stopPropagation()
              }
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="Clear search"
              title="Clear (ESC)"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
          <div
            className="w-32 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground/80"
            aria-live="polite"
          >
            {inSearchMode && searchLoadState === "loading" && (
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                Searching…
              </span>
            )}
            {inSearchMode && searchLoadState === "ready" && (
              <>
                {searchResults.length}{" "}
                {searchResults.length === 1 ? "match" : "matches"}
                <span className="ml-1 text-muted-foreground/60">· {searchTookMs}ms</span>
              </>
            )}
            {inSearchMode && searchLoadState === "error" && (
              <span className="text-destructive">Search error</span>
            )}
          </div>
        </div>

        {/* ── Body: sidebar + list ──────────────────────────────────── */}
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] overflow-hidden">
          <QuickNavSidebar
            drives={drives}
            favorites={favorites}
            currentPath={currentPath}
            onNavigate={navigateTo}
            onRemoveFavorite={removeFavorite}
          />
          <div className="flex min-h-0 flex-col overflow-hidden">
            {/* Column header (subtle) */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border/30 px-4 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
              <span className="flex-1">
                {inSearchMode ? "Result" : "Name"}
                {totalEntries > 0 && (
                  <span className="ml-2 normal-case text-[10px] text-muted-foreground/50">
                    {totalEntries} {totalEntries === 1 ? "item" : "items"}
                  </span>
                )}
              </span>
              <span className="hidden w-[68px] shrink-0 text-right sm:inline">Size</span>
              <span className="hidden w-[88px] shrink-0 text-right md:inline">Modified</span>
            </div>

            {loadState === "error" && !inSearchMode ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <XIcon className="size-6" />
                </div>
                <div className="text-sm text-destructive">
                  {errorMessage ?? "Failed to list directory"}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigateTo(currentPath ?? "")}
                >
                  Retry
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                {inSearchMode ? (
                  searchLoadState === "loading" ? (
                    <>
                      <div className="size-2 animate-pulse rounded-full bg-primary" />
                      <div className="text-xs text-muted-foreground">Searching…</div>
                    </>
                  ) : (
                    <>
                      <SearchIcon
                        className="size-10 text-muted-foreground/30"
                        strokeWidth={1.25}
                      />
                      <div className="text-sm font-medium text-foreground/80">No matches</div>
                      <div className="max-w-[280px] text-xs text-muted-foreground">
                        Nothing in <span className="font-mono">{shortenPath(currentPath ?? "")}</span> matches "{searchQuery}".
                      </div>
                    </>
                  )
                ) : loadState === "loading" ? (
                  <>
                    <div className="size-2 animate-pulse rounded-full bg-primary" />
                    <div className="text-xs text-muted-foreground">Loading…</div>
                  </>
                ) : (
                  <>
                    <FolderOpenIcon
                      className="size-10 text-muted-foreground/30"
                      strokeWidth={1.25}
                    />
                    <div className="text-sm font-medium text-foreground/80">Empty folder</div>
                    <div className="text-xs text-muted-foreground">
                      Try toggling hidden files
                      <kbd className="mx-1 inline-flex h-4 items-center rounded bg-muted px-1 font-mono text-[10px]">
                        Ctrl+H
                      </kbd>
                      or pick this folder anyway.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <FileListVirtual
                items={items}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                onActivate={(i) => {
                  const it = items[i]
                  if (it?.isDir) {
                    if (currentPath && !inSearchMode) {
                      rememberSelection(currentPath, it.name)
                    }
                    navigateTo(it.path)
                  }
                }}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavoritePath}
                listboxId={LISTBOX_ID}
                ariaLabel={inSearchMode ? "Search results" : "Directory contents"}
              />
            )}
            {truncated && !inSearchMode && (
              <div className="shrink-0 border-t border-border/30 px-4 py-1.5 text-[10.5px] text-muted-foreground/80">
                <span className="font-medium">Note:</span> listing truncated to 5000 entries.
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border/40 px-4 py-2.5">
          <div className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground/80">
            {activeItem ? activeItem.path : currentPath}
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/80 xl:flex">
            <kbd className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">
              ↑↓
            </kbd>
            <span>nav</span>
            <kbd className="ml-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">
              ⏎
            </kbd>
            <span>open</span>
            <kbd className="ml-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">
              Ctrl+D
            </kbd>
            <span>favorite</span>
            <kbd className="ml-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">
              Ctrl+⏎
            </kbd>
            <span>open as project</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="shrink-0"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={openAsProject}
            disabled={!currentPath && !activeItem}
            className="shrink-0 gap-1.5"
          >
            <FolderOpenIcon className="size-3.5" />
            Open folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function parentDir(full: string, root: string | null): string | undefined {
  if (!root) return undefined
  const p = full.replace(/[\\/][^\\/]*$/, "")
  if (p === full) return undefined
  if (p === root) return ""
  if (p.startsWith(root)) {
    const rel = p.slice(root.length).replace(/^[\\/]+/, "")
    return rel
  }
  return p
}

function shortenPath(p: string): string {
  if (p.length <= 32) return p
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return p
  return `…${p.slice(-30)}`
}
