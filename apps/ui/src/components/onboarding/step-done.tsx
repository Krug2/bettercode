import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { assetUrl } from "@/lib/asset-url"
import { useOnboardingStore } from "@/lib/onboarding-store"
import {
  ChevronLeftIcon,
  Loader2Icon,
  RocketIcon,
} from "lucide-react"

export function DoneStep() {
  const {
    selectedMcp,
    selectedSkills,
    selectedAgents,
    selectedPlugins,
    complete,
    importing,
    prevStep,
  } = useOnboardingStore()
  const total =
    selectedMcp.size +
    selectedSkills.size +
    selectedAgents.size +
    selectedPlugins.size

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 py-6 text-center">
      <img src={assetUrl("favicon.svg")} alt="" className="size-14" />
      <div>
        <h2 className="text-lg font-bold">You're all set</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {total > 0
            ? `Importing ${total} items.`
            : "You can configure providers and tools in Settings anytime."}
        </p>
      </div>
      {total > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {selectedMcp.size > 0 && (
            <Badge variant="secondary">{selectedMcp.size} MCP</Badge>
          )}
          {selectedPlugins.size > 0 && (
            <Badge variant="secondary">{selectedPlugins.size} Plugins</Badge>
          )}
          {selectedSkills.size > 0 && (
            <Badge variant="secondary">{selectedSkills.size} Skills</Badge>
          )}
          {selectedAgents.size > 0 && (
            <Badge variant="secondary">{selectedAgents.size} Subagents</Badge>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={prevStep}>
          <ChevronLeftIcon className="mr-1 size-3.5" />
          Back
        </Button>
        <Button className="gap-2" disabled={importing} onClick={complete}>
          {importing ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RocketIcon className="size-4" />
          )}
          Launch BetterC0de
        </Button>
      </div>
    </div>
  )
}
