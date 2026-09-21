import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ImportedThemeSummary } from "@betterc0de/schema"
import {
  CheckIcon,
  ClipboardPasteIcon,
  DownloadIcon,
  FileJsonIcon,
  LoaderCircleIcon,
  PaletteIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { SettingsSection } from "@/components/settings/atoms"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { MENU_INPUT, MENU_ITEM, MENU_LIST } from "@/components/ui/menu-chrome"
import { useConfirm } from "@/components/dialogs/confirm-provider"
import { useAppearanceStore } from "@/lib/appearance-store"
import { customTemplateId } from "@/lib/vscode-theme"
import { isRemoteRuntime } from "@/services/backend/runtime"
import {
  deleteImportedTheme,
  getImportedTheme,
  importInstalledTheme,
  importThemeText,
  listImportedThemes,
  listInstalledThemes,
  type InstalledThemeInfo,
} from "@/services/backend/themesApi"

const APP_LABEL: Record<InstalledThemeInfo["app"], string> = {
  vscode: "VS Code",
  cursor: "Cursor",
}

function sourceLabel(summary: ImportedThemeSummary): string {
  switch (summary.source.kind) {
    case "vscode":
      return `VS Code · ${summary.source.label}`
    case "cursor":
      return `Cursor · ${summary.source.label}`
    case "file":
      return summary.source.label
    default:
      return "Pasted JSON"
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return message.trim() || "The backend gave no reason."
}

/**
 * Imported VS Code / Cursor / custom themes: the list, activation, removal,
 * and the three ways in — the installed editors on this machine, a theme
 * file, or pasted JSON. Activation converts the theme in the renderer and
 * caches it, so the choice survives restarts without a backend round trip.
 */
export function SettingsImportedThemesSection() {
  const template = useAppearanceStore((state) => state.template)
  const activateCustomTheme = useAppearanceStore(
    (state) => state.activateCustomTheme
  )
  const forgetCustomTheme = useAppearanceStore(
    (state) => state.forgetCustomTheme
  )
  const remote = isRemoteRuntime()
  const confirm = useConfirm()
  const [themes, setThemes] = useState<ImportedThemeSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setThemes(await listImportedThemes())
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
      setThemes([])
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const activate = async (id: string) => {
    setBusy(`activate:${id}`)
    try {
      activateCustomTheme(await getImportedTheme(id))
    } catch (cause) {
      toast.error("Could not apply the theme", {
        description: errorText(cause),
      })
    } finally {
      setBusy(null)
    }
  }

  const finishImport = async (imported: { id: string; name: string }) => {
    await refresh()
    await activate(imported.id)
    toast.success(`Imported ${imported.name}`)
  }

  const importFromFile = async (file: File) => {
    setBusy("file")
    try {
      const text = await file.text()
      await finishImport(
        await importThemeText({
          text,
          source: "file",
          label: file.name,
          name: file.name
            .replace(/\.(json|jsonc)$/i, "")
            .replace(/[-_]+/g, " "),
        })
      )
    } catch (cause) {
      toast.error("Could not import the theme file", {
        description: errorText(cause),
      })
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const importPasted = async () => {
    setBusy("paste")
    try {
      await finishImport(
        await importThemeText({ text: pasteText, source: "paste" })
      )
      setPasteOpen(false)
      setPasteText("")
    } catch (cause) {
      toast.error("Could not import the pasted theme", {
        description: errorText(cause),
      })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (summary: ImportedThemeSummary) => {
    const ok = await confirm({
      title: `Remove ${summary.name}?`,
      description:
        "The theme is deleted from this computer. You can import it again any time.",
      confirmLabel: "Remove",
      destructive: true,
    })
    if (!ok) return
    setBusy(`remove:${summary.id}`)
    try {
      await deleteImportedTheme(summary.id)
      forgetCustomTheme(summary.id)
      await refresh()
    } catch (cause) {
      toast.error("Could not remove the theme", {
        description: errorText(cause),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsSection
      title="Imported themes"
      description="Any VS Code color theme works here — Cursor and custom themes use the same format. The theme colors the whole workbench, the editor and code in chat."
    >
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <InstalledThemePicker
            disabled={remote || busy !== null}
            busy={busy === "installed"}
            onPick={async (installed) => {
              setBusy("installed")
              try {
                await finishImport(await importInstalledTheme(installed.id))
              } catch (cause) {
                toast.error(`Could not import ${installed.label}`, {
                  description: errorText(cause),
                })
              } finally {
                setBusy(null)
              }
            }}
          />
          <Button
            disabled={remote || busy !== null}
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            variant="outline"
            className="gap-1.5"
          >
            {busy === "file" ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <FileJsonIcon className="size-3.5" />
            )}
            Import file…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.jsonc,application/json"
            className="hidden"
            aria-label="Choose a theme file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFromFile(file)
            }}
          />
          <Button
            disabled={remote || busy !== null}
            onClick={() => setPasteOpen(true)}
            size="sm"
            variant="outline"
            className="gap-1.5"
          >
            <ClipboardPasteIcon className="size-3.5" />
            Paste JSON…
          </Button>
          <Button
            aria-label="Refresh imported themes"
            disabled={busy !== null}
            onClick={() => void refresh()}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
        {remote && (
          <p className="text-[11px] text-muted-foreground">
            Importing and removing themes happens on the desktop; a paired
            browser can switch between the ones already imported.
          </p>
        )}

        {themes === null ? (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        ) : themes.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-4 text-[11px] text-muted-foreground">
            <PaletteIcon className="size-4 shrink-0" strokeWidth={1.5} />
            No imported themes yet. Pull one in from VS Code or Cursor, or drop
            in a theme file.
          </div>
        ) : (
          <ImportedThemeList
            themes={themes}
            activeTemplate={template}
            busy={busy}
            remote={remote}
            onActivate={(id) => void activate(id)}
            onRemove={(summary) => void remove(summary)}
          />
        )}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Paste a theme</DialogTitle>
            <DialogDescription>
              The contents of a VS Code color theme file (<code>.json</code>,
              comments allowed). Themes that <code>include</code> another file
              have to be imported from the installed editor instead.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Theme JSON"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={
              '{\n  "name": "My Theme",\n  "type": "dark",\n  "colors": { "editor.background": "#1e1e1e" },\n  "tokenColors": []\n}'
            }
            spellCheck={false}
            className="min-h-48 font-mono text-[12px]"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPasteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!pasteText.trim() || busy !== null}
              onClick={() => void importPasted()}
              className="gap-1.5"
            >
              {busy === "paste" ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}

/** The imported-theme cards. Pure props so every state renders without a DOM. */
export function ImportedThemeList({
  themes,
  activeTemplate,
  busy,
  remote,
  onActivate,
  onRemove,
}: {
  themes: ImportedThemeSummary[]
  activeTemplate: string
  busy: string | null
  remote: boolean
  onActivate: (id: string) => void
  onRemove: (summary: ImportedThemeSummary) => void
}) {
  const template = activeTemplate
  const activate = (id: string) => onActivate(id)
  const remove = (summary: ImportedThemeSummary) => onRemove(summary)
  return (
    <ul
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      aria-label="Imported themes"
    >
      {themes.map((summary) => {
        const active = template === customTemplateId(summary.id)
        return (
          <li
            key={summary.id}
            data-imported-theme={summary.id}
            data-active={active || undefined}
            className={cn(
              "group/theme flex items-center gap-3 rounded-xl border-2 p-2.5 transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-transparent bg-muted/20 hover:bg-muted/40"
            )}
          >
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => activate(summary.id)}
              aria-pressed={active}
              aria-label={`Use ${summary.name}`}
              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <span className="flex h-8 w-16 shrink-0 gap-1 overflow-hidden rounded-lg">
                <span
                  className="flex-[3]"
                  style={{ background: summary.preview.bg }}
                />
                <span
                  className="flex-[1]"
                  style={{ background: summary.preview.sidebar }}
                />
                <span
                  className="w-1.5 rounded-full"
                  style={{ background: summary.preview.accent }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12px] font-medium">
                  <span className="truncate">{summary.name}</span>
                  <span className="shrink-0 rounded bg-muted/60 px-1 text-[9px] tracking-wide text-muted-foreground uppercase">
                    {summary.mode}
                  </span>
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {sourceLabel(summary)}
                </span>
              </span>
              {busy === `activate:${summary.id}` ? (
                <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : active ? (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              ) : null}
            </button>
            {!remote && (
              <Button
                aria-label={`Remove ${summary.name}`}
                disabled={busy !== null}
                onClick={() => remove(summary)}
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/theme:opacity-100 hover:text-destructive focus-visible:opacity-100"
              >
                {busy === `remove:${summary.id}` ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                ) : (
                  <Trash2Icon className="size-3.5" />
                )}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Themes VS Code and Cursor already have on this machine — built-in ones
 * and installed extensions — in a searchable list. Scanned when opened, so
 * a theme installed a minute ago shows up without a restart.
 *
 * A nested Dialog rather than a Popover on purpose: the settings surface is
 * itself a Dialog, and a portaled Popover inside it loses the focus fight
 * (the outer focus trap pulls focus back, the popover reads that as an
 * outside interaction and closes before the click lands). Dialogs share one
 * focus-scope stack, so the inner one pauses the outer.
 */
function InstalledThemePicker({
  disabled,
  busy,
  onPick,
}: {
  disabled: boolean
  busy: boolean
  onPick: (theme: InstalledThemeInfo) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [installed, setInstalled] = useState<InstalledThemeInfo[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setInstalled(null)
    setScanError(null)
    listInstalledThemes()
      .then((themes) => {
        if (!cancelled) setInstalled(themes)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setScanError(errorText(cause))
          setInstalled([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const groups = useMemo(() => {
    const byApp = new Map<InstalledThemeInfo["app"], InstalledThemeInfo[]>()
    for (const theme of installed ?? []) {
      const list = byApp.get(theme.app) ?? []
      list.push(theme)
      byApp.set(theme.app, list)
    }
    return [...byApp.entries()]
  }, [installed])

  const total = installed?.length ?? 0
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        disabled={disabled}
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        {busy ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="size-3.5" />
        )}
        Import from VS Code / Cursor…
      </Button>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Import an installed theme</DialogTitle>
          <DialogDescription>
            {installed === null
              ? "Scanning VS Code and Cursor on this computer…"
              : total === 0
                ? "Color themes from VS Code and Cursor on this computer."
                : `${total} color ${total === 1 ? "theme" : "themes"} found in VS Code and Cursor on this computer.`}
          </DialogDescription>
        </DialogHeader>
        <div className="border-t border-border/40 px-2 pt-2 pb-2">
          <Command loop>
            <CommandInput
              className={MENU_INPUT}
              placeholder="Search installed themes"
            />
            <CommandList className={cn(MENU_LIST, "max-h-[min(420px,55vh)]")}>
              <CommandEmpty className="px-2 py-3 text-[11px] text-muted-foreground">
                {installed === null
                  ? "Scanning installed editors…"
                  : scanError
                    ? scanError
                    : "No VS Code or Cursor themes found on this computer."}
              </CommandEmpty>
              {groups.map(([app, themes]) => (
                <CommandGroup key={app} heading={APP_LABEL[app]}>
                  {themes.map((theme) => (
                    <CommandItem
                      key={theme.id}
                      className={MENU_ITEM}
                      value={`${theme.label} ${theme.extensionName} ${theme.extensionId}`}
                      onSelect={() => {
                        setOpen(false)
                        void onPick(theme)
                      }}
                    >
                      <PaletteIcon className="size-3.5" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{theme.label}</span>
                        <span className="block truncate text-[10px] text-muted-foreground/70">
                          {theme.extensionName}
                        </span>
                      </span>
                      <span className="shrink-0 text-[9px] tracking-wide text-muted-foreground/60 uppercase">
                        {theme.uiTheme === "vs" || theme.uiTheme === "hc-light"
                          ? "light"
                          : "dark"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  )
}
