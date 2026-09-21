import {
  HomeIcon,
  HardDriveIcon,
  StarIcon,
  XIcon,
  FolderIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { DriveEntry } from "@/services/backend/filesystem"

interface QuickNavSidebarProps {
  drives: DriveEntry[]
  favorites: string[]
  currentPath: string | null
  onNavigate: (path: string) => void
  onRemoveFavorite: (path: string) => void
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between px-3 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function NavRow({
  label,
  path,
  active,
  icon,
  onClick,
  dimmed,
  action,
}: {
  label: string
  path: string
  active: boolean
  icon: React.ReactNode
  onClick: () => void
  dimmed?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "group mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-2.5 text-xs transition-colors",
        active
          ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30"
          : "text-foreground/85 hover:bg-muted/60 hover:text-foreground",
        dimmed && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-2.5 truncate text-left"
        title={path}
      >
        <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>
          {icon}
        </span>
        <span className="truncate font-medium">{label}</span>
      </button>
      {action}
    </div>
  )
}

export function QuickNavSidebar(props: QuickNavSidebarProps) {
  const { drives, favorites, currentPath, onNavigate, onRemoveFavorite } = props

  const shortcuts = drives.filter((d) => d.kind === "home" || d.kind === "shortcut")
  const physical = drives.filter(
    (d) => d.kind === "drive" || d.kind === "volume" || d.kind === "root",
  )

  return (
    <div className="flex h-full flex-col gap-0 overflow-y-auto border-r border-border/40 py-3">
      {shortcuts.length > 0 && (
        <Section title="Home">
          {shortcuts.map((d) => (
            <NavRow
              key={d.path}
              label={d.label}
              path={d.path}
              active={currentPath === d.path}
              icon={<HomeIcon className="size-3.5" strokeWidth={1.75} />}
              onClick={() => onNavigate(d.path)}
              dimmed={!d.reachable}
            />
          ))}
        </Section>
      )}

      {physical.length > 0 && (
        <Section
          title={
            physical[0].kind === "drive"
              ? "Drives"
              : physical[0].kind === "volume"
                ? "Volumes"
                : "Locations"
          }
        >
          {physical.map((d) => (
            <NavRow
              key={d.path}
              label={d.label}
              path={d.path}
              active={currentPath === d.path}
              icon={<HardDriveIcon className="size-3.5" strokeWidth={1.75} />}
              onClick={() => onNavigate(d.path)}
              dimmed={!d.reachable}
            />
          ))}
        </Section>
      )}

      {favorites.length > 0 ? (
        <Section title="Favorites" count={favorites.length}>
          {favorites.map((p) => {
            const label = p.split(/[\\/]/).filter(Boolean).pop() ?? p
            return (
              <NavRow
                key={p}
                label={label}
                path={p}
                active={currentPath === p}
                icon={
                  <StarIcon
                    className="size-3.5 fill-yellow-500 text-yellow-500"
                    strokeWidth={1.5}
                  />
                }
                onClick={() => onNavigate(p)}
                action={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveFavorite(p)
                    }}
                    className="hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:inline-flex"
                    aria-label={`Remove ${label} from favorites`}
                    title="Remove from favorites"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                }
              />
            )
          })}
        </Section>
      ) : (
        <Section title="Favorites">
          <div className="mx-1.5 rounded-md border border-dashed border-border/40 px-3 py-3 text-[10.5px] leading-relaxed text-muted-foreground/70">
            <FolderIcon className="mb-1.5 size-4 text-muted-foreground/40" strokeWidth={1.5} />
            Star a folder via the row icon or
            <kbd className="mx-1 inline-flex h-4 items-center rounded bg-muted px-1 font-mono text-[9px]">
              Ctrl+D
            </kbd>
            to pin it here.
          </div>
        </Section>
      )}
    </div>
  )
}
