import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useOnboardingStore } from "@/lib/onboarding-store"
import {
  CheckIcon,
  Loader2Icon,
  ServerIcon,
  SparklesIcon,
  BrainIcon,
} from "lucide-react"
import { StepHeader, NavFooter } from "./shared"

export function ImportStep() {
  const {
    scanResult,
    scanning,
    startScan,
    selectedMcp,
    selectedSkills,
    selectedAgents,
    selectedPlugins,
    toggleMcp,
    toggleSkill,
    toggleAgent,
    togglePlugin,
    nextStep,
    prevStep,
  } = useOnboardingStore()

  useEffect(() => {
    if (!scanResult) startScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allMcp = [
    ...(scanResult?.claude?.mcpServers || []),
    ...(scanResult?.codex?.mcpServers || []),
  ]
  const allSkills = [
    ...(scanResult?.claude?.skills || []),
    ...(scanResult?.codex?.skills || []),
  ]
  const allAgents = [
    ...(scanResult?.claude?.agents || []),
    ...(scanResult?.codex?.agents || []),
  ]
  const allPlugins = scanResult?.claude?.plugins || []
  const total =
    allMcp.length + allSkills.length + allAgents.length + allPlugins.length

  return (
    <div className="w-full max-w-lg">
      <StepHeader
        title="Import from CLI"
        description={
          scanning
            ? "Scanning CLI configs..."
            : total > 0
              ? `Found ${total} items. Toggle what to import.`
              : "No CLI configs found."
        }
      />

      {scanning ? (
        <div className="flex items-center justify-center py-12">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No MCP servers, skills, or subagents found in CLI configs.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/50">
            You can add them later in Settings.
          </p>
        </div>
      ) : (
        <div className="max-h-[42vh] space-y-3 overflow-y-auto">
          {allMcp.length > 0 && (
            <ImportGroup
              title="MCP Servers"
              icon={<ServerIcon className="size-3.5" />}
              items={allMcp}
              selected={selectedMcp}
              onToggle={toggleMcp}
            />
          )}
          {allPlugins.length > 0 && (
            <ImportGroup
              title="Plugins"
              icon={<SparklesIcon className="size-3.5" />}
              items={allPlugins}
              selected={selectedPlugins}
              onToggle={togglePlugin}
            />
          )}
          {allSkills.length > 0 && (
            <ImportGroup
              title="Skills"
              icon={<SparklesIcon className="size-3.5" />}
              items={allSkills}
              selected={selectedSkills}
              onToggle={toggleSkill}
            />
          )}
          {allAgents.length > 0 && (
            <ImportGroup
              title="Subagents"
              icon={<BrainIcon className="size-3.5" />}
              items={allAgents}
              selected={selectedAgents}
              onToggle={toggleAgent}
            />
          )}
        </div>
      )}

      <NavFooter onBack={prevStep} onNext={nextStep} />
    </div>
  )
}

function ImportGroup({
  title,
  icon,
  items,
  selected,
  onToggle,
}: {
  title: string
  icon: React.ReactNode
  items: { id: string; name: string; source: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Badge variant="secondary" className="ml-auto px-1.5 text-[9px]">
          {items.filter((i) => selected.has(i.id)).length}/{items.length}
        </Badge>
      </div>
      <div className="divide-y divide-border/30 rounded-lg border border-border/50">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
              selected.has(item.id) ? "bg-accent/50" : "hover:bg-muted/30"
            )}
          >
            <div
              className={cn(
                "flex size-4 items-center justify-center rounded border",
                selected.has(item.id)
                  ? "border-primary bg-primary"
                  : "border-border"
              )}
            >
              {selected.has(item.id) && (
                <CheckIcon className="size-2.5 text-primary-foreground" />
              )}
            </div>
            <span className="flex-1 truncate text-xs font-medium">
              {item.name}
            </span>
            <Badge variant="outline" className="text-[9px]">
              {item.source}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  )
}
