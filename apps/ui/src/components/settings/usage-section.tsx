import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { usePreferencesStore } from "@/lib/preferences-store"
import { SettingsRow, SettingsSection } from "./atoms"

const blocks = [
  { id: "summary", label: "Summary", description: "Token totals, peak usage, chat duration, and streaks" },
  { id: "blobs", label: "Token explorer", description: "Interactive blobs for models, tokens, and spend" },
  { id: "activity", label: "Token activity", description: "Daily, weekly, and cumulative activity charts" },
  { id: "insights", label: "Activity insights", description: "Fast mode, reasoning, and skills" },
  { id: "tools", label: "Tools and plugins", description: "Your most used tools and plugins" },
  { id: "models", label: "Model breakdown", description: "Tokens and reported costs for each model" },
  { id: "details", label: "Usage details", description: "Recorded responses, reported spend, and data coverage" },
]

export function SettingsUsageSection() {
  const hidden = usePreferencesStore(state => state.hiddenUsageBlocks)
  const set = usePreferencesStore(state => state.set)

  return (
    <div className="space-y-4">
      <SettingsSection title="Visible blocks" description="Choose what appears on your usage page and usage windows. Hidden blocks keep their data and saved positions.">
        {blocks.map(block => (
          <SettingsRow key={block.id} label={block.label} description={block.description}>
            <Switch aria-label={block.label} checked={!hidden.includes(block.id)} onCheckedChange={checked => {
              const current = usePreferencesStore.getState().hiddenUsageBlocks
              set("hiddenUsageBlocks", checked ? current.filter(id => id !== block.id) : [...new Set([...current, block.id])])
            }} />
          </SettingsRow>
        ))}
      </SettingsSection>
      <Button variant="outline" size="sm" disabled={!hidden.length} onClick={() => set("hiddenUsageBlocks", [])}>Show all blocks</Button>
    </div>
  )
}
