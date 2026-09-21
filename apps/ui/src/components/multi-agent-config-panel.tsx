import {
  BotIcon,
  ChevronDownIcon,
  MinusIcon,
  PlusIcon,
  PlayIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { useMultiAgentStore, type AgentConfig } from "@/lib/multi-agent-store"
import { resolveDefaultProvider } from "@/lib/provider-model-selection"
import type { UiProvider } from "@/lib/provider-types"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  SimpleDropdown,
  SimpleDropdownSub,
  SimpleDropdownSubItem,
} from "@/components/ui/simple-dropdown"

const MAX_AGENTS = 10

const ROLE_PRESETS = [
  {
    id: "architect",
    label: "Architect",
    role: "Architecture, ownership map, integration risks",
  },
  {
    id: "frontend",
    label: "Frontend",
    role: "Editor UI, React state, accessibility, polish",
  },
  {
    id: "backend",
    label: "Backend",
    role: "Provider runtime, API routes, persistence, IPC",
  },
  {
    id: "qa",
    label: "QA",
    role: "Tests, regressions, verification gates",
  },
] as const

export function MultiAgentConfigPanel({
  open,
  onOpenChange,
  providers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: UiProvider[]
}) {
  const session = useMultiAgentStore((s) => s.session)
  const setTask = useMultiAgentStore((s) => s.setTask)
  const addAgent = useMultiAgentStore((s) => s.addAgent)
  const removeAgent = useMultiAgentStore((s) => s.removeAgent)
  const updateAgentModel = useMultiAgentStore((s) => s.updateAgentModel)
  const updateAgentRole = useMultiAgentStore((s) => s.updateAgentRole)
  const setMaxTurns = useMultiAgentStore((s) => s.setMaxTurns)

  if (!session) return null

  const defaultProvider = resolveDefaultProvider(providers)
  const defaultModel = defaultProvider?.models[0]
  const canAddAgent =
    Boolean(defaultProvider && defaultModel) &&
    session.agents.length < MAX_AGENTS
  const hasDefaultModel = Boolean(defaultProvider && defaultModel)
  const agentsHaveModels = session.agents.every((agent) =>
    providers.some(
      (provider) =>
        provider.id === agent.providerId &&
        provider.models.some((model) => model.id === agent.modelId)
    )
  )
  const canStart =
    session.agents.length > 0 &&
    Boolean(session.task.trim()) &&
    agentsHaveModels
  const footerMessage =
    providers.length === 0
      ? "Add a provider before starting a swarm."
      : !hasDefaultModel
        ? "Add at least one provider model."
        : !agentsHaveModels
          ? "One or more agents need an available model."
          : canStart
            ? "Ready to start."
            : "Task and at least one agent are required."

  function getModelLabel(agent: AgentConfig): string {
    for (const provider of providers) {
      const model = provider.models.find(
        (candidate) => candidate.id === agent.modelId
      )
      if (model) return `${provider.name} / ${model.name}`
    }
    return agent.modelId
  }

  function handleAddAgent(role = ""): void {
    if (!defaultProvider || !defaultModel) return
    addAgent(defaultModel.id, defaultProvider.id, role)
  }

  function handleStart(): void {
    window.dispatchEvent(new CustomEvent("betterc0de:multi-agent-start"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden border-border/45 bg-card p-0 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/45 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/60 text-foreground">
              <BotIcon className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold">
                Agent Workbench
              </DialogTitle>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Configure parallel workers for the current editor task.
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-border/35 bg-background/45 px-2 py-1 text-right">
            <p className="font-mono text-xs font-semibold">
              {session.agents.length}/{MAX_AGENTS}
            </p>
            <p className="text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
              Agents
            </p>
          </div>
        </div>

        <div className="grid max-h-[70vh] gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Task
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {session.task.trim().length} chars
              </span>
            </div>
            <Textarea
              className="min-h-24 resize-y border-border/35 bg-background/50 text-xs leading-relaxed placeholder:text-muted-foreground/45"
              placeholder="Describe the concrete task these agents should solve..."
              value={session.task}
              onChange={(event) => setTask(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Role Presets
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {defaultProvider && defaultModel
                  ? `${defaultProvider.name} / ${defaultModel.name}`
                  : "No model"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {ROLE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 justify-start gap-1.5 px-2 text-[11px]"
                  disabled={!canAddAgent}
                  onClick={() => handleAddAgent(preset.role)}
                  title={preset.role}
                >
                  <SparklesIcon className="size-3" />
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Agents
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-dashed border-border/40 px-2 text-[10px] text-muted-foreground"
                disabled={!canAddAgent}
                onClick={() => handleAddAgent()}
              >
                <PlusIcon className="size-3" />
                Add Blank
              </Button>
            </div>

            {session.agents.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/45 bg-background/35 px-3 py-4 text-center">
                <p className="text-xs font-medium text-foreground">
                  No agents configured
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Add role presets or a blank worker before starting.
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                {session.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="grid grid-cols-[minmax(82px,0.8fr)_minmax(130px,1fr)_24px] items-center gap-2 rounded-md border border-border/30 bg-background/35 px-2 py-2 sm:grid-cols-[minmax(90px,0.6fr)_minmax(160px,1fr)_minmax(150px,0.9fr)_24px]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: agent.color }}
                        aria-hidden
                      />
                      <span className="truncate text-xs font-semibold">
                        {agent.name}
                      </span>
                    </div>

                    <SimpleDropdown
                      align="start"
                      trigger={
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/30 bg-background/55 px-2 py-1.5 text-left text-[11px] hover:bg-background/85 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="truncate">
                            {getModelLabel(agent)}
                          </span>
                          <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
                        </button>
                      }
                      className="max-h-[260px] min-w-[220px] overflow-y-auto"
                    >
                      {providers.map((provider) => (
                        <SimpleDropdownSub
                          key={provider.id}
                          trigger={provider.name}
                        >
                          {provider.models.map((model) => (
                            <SimpleDropdownSubItem
                              key={model.id}
                              onClick={() =>
                                updateAgentModel(
                                  agent.id,
                                  model.id,
                                  provider.id
                                )
                              }
                              active={
                                agent.modelId === model.id &&
                                agent.providerId === provider.id
                              }
                            >
                              {model.name}
                            </SimpleDropdownSubItem>
                          ))}
                        </SimpleDropdownSub>
                      ))}
                    </SimpleDropdown>

                    <Input
                      className="order-4 col-span-3 h-8 min-w-0 border-border/30 bg-background/55 px-2 text-[11px] placeholder:text-muted-foreground/45 sm:order-none sm:col-span-1"
                      placeholder="Role / lane"
                      value={agent.role}
                      onChange={(event) =>
                        updateAgentRole(agent.id, event.target.value)
                      }
                    />

                    <button
                      type="button"
                      onClick={() => removeAgent(agent.id)}
                      className="order-3 flex size-6 items-center justify-center rounded text-muted-foreground/55 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none sm:order-none"
                      aria-label={`Remove ${agent.name}`}
                      title="Remove agent"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/30 bg-background/35 px-3 py-2">
            <div>
              <p className="text-[11px] font-medium text-foreground">
                Max turns per agent
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Hard stop for this swarm run.
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => setMaxTurns(session.maxTurnsPerAgent - 1)}
                aria-label="Decrease max turns"
              >
                <MinusIcon className="size-3.5" />
              </button>
              <span className="w-8 text-center font-mono text-xs font-medium">
                {session.maxTurnsPerAgent}
              </span>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => setMaxTurns(session.maxTurnsPerAgent + 1)}
                aria-label="Increase max turns"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/45 px-5 py-3">
          <p className="min-w-0 truncate text-[10px] text-muted-foreground">
            {footerMessage}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              disabled={!canStart}
              onClick={handleStart}
            >
              <PlayIcon className="size-3.5" />
              Start Swarm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
