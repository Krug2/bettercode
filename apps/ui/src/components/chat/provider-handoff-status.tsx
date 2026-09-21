import { CheckIcon, ChevronDownIcon, AlertCircleIcon, ArrowRightIcon, TerminalIcon } from "lucide-react"
import { AgentActivity, agentActivityPillClassName } from "@/components/ai-elements/agent-activity"
import { MessageResponse } from "@/components/ai-elements/message"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatProviderActivityLabel } from "@/lib/provider-label"
import type { ProviderHandoffEntry } from "@/lib/provider-handoff"
import { cn } from "@/lib/utils"
import { getModelInfo } from "@/lib/get-model-info"
import { builtinProviders } from "@/lib/builtin-providers"
import { logoNeedsDarkInvert } from "@/lib/logo-invert"

function providerName(providerKind: string): string {
  return formatProviderActivityLabel({ providerKind }).replace(/ CLI$/, "")
}

function providerLogo(kind?: string): string {
  const key = kind?.toLowerCase().replace(/[-_]/g, "")
  return builtinProviders.find(provider => (provider.providerKind ?? provider.id).toLowerCase().replace(/[-_]/g, "") === key)?.logo ?? ""
}

function HandoffLogo({ logo }: { logo: string }) {
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]" aria-hidden="true">
    {logo ? <img src={logo} alt="" className={cn("size-5 object-contain", logoNeedsDarkInvert(logo) && "dark:invert")} /> : <TerminalIcon className="size-4 text-muted-foreground" />}
  </span>
}

export function ProviderHandoffOverview({ entry, workspaceRoot }: { entry: ProviderHandoffEntry; workspaceRoot?: string | null }) {
  const sourceModel = getModelInfo(entry.sourceModel)
  const sourceName = sourceModel?.name ?? (entry.sourceProvider ? providerName(entry.sourceProvider) : "Previous model")
  return <section aria-label="Previous context overview" className="mt-2 w-full max-w-2xl overflow-hidden rounded-xl bg-foreground/[0.025] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
    {entry.sourceProvider && entry.targetProvider && <header className="border-b border-border/40 px-4 py-3">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        <div className="flex min-w-0 items-center gap-2.5"><HandoffLogo logo={sourceModel?.logo || providerLogo(entry.sourceProvider)} /><div className="min-w-0"><dt className="mb-0.5 text-[11px] text-muted-foreground">Previous model</dt><dd className="truncate text-[13px] font-medium text-foreground" title={sourceName}>{sourceName}</dd></div></div>
        <ArrowRightIcon className="size-4 text-muted-foreground/60" aria-hidden="true" />
        <div className="flex min-w-0 items-center gap-2.5"><HandoffLogo logo={providerLogo(entry.targetProvider)} /><div className="min-w-0"><dt className="mb-0.5 text-[11px] text-muted-foreground">Next provider</dt><dd className="truncate text-[13px] font-medium text-foreground">{providerName(entry.targetProvider)}</dd></div></div>
      </dl>
    </header>}
    <div className="max-h-80 overflow-y-auto p-4 text-[13px] leading-relaxed text-foreground/85">
      <MessageResponse workspaceRoot={workspaceRoot}>{entry.summary ?? ""}</MessageResponse>
    </div>
  </section>
}

export function ProviderHandoffStatus({ entry, workspaceRoot }: {
  entry: ProviderHandoffEntry
  workspaceRoot?: string | null
}) {
  const providerTransition = entry.sourceProvider && entry.targetProvider
    ? `${providerName(entry.sourceProvider)} → ${providerName(entry.targetProvider)}`
    : null
  const transitionPrefix = providerTransition ? `${providerTransition} · ` : ""
  if (entry.status === "compacting") {
    return <AgentActivity state="solving" label={`${transitionPrefix}Compacting previous context…`} />
  }
  if (entry.status === "failed" || entry.status === "interrupted") {
    return <span role="status" className={agentActivityPillClassName}>
      <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 text-left">{transitionPrefix}{entry.status === "failed" ? "Context handoff failed" : "Context handoff interrupted"}</span>
    </span>
  }
  return <Collapsible className="max-w-full" defaultOpen={false}>
    <CollapsibleTrigger disabled={!entry.summary} className={cn(agentActivityPillClassName,
      "group min-h-10 cursor-pointer font-normal hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default")}>
      <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 text-left">Context Compacted</span>
      {entry.summary && <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ProviderHandoffOverview entry={entry} workspaceRoot={workspaceRoot} />
    </CollapsibleContent>
  </Collapsible>
}
