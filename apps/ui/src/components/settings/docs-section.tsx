import { Button } from "@/components/ui/button"
import { SettingsRow, SettingsSection } from "@/components/settings/atoms"

/**
 * "Docs" settings tab content — three entry points for reference
 * material: the getting-started primer, an external link to the docs
 * site, and the keyboard-shortcuts reference. The first and third open
 * dialogs owned by the parent modal; the middle one opens a new tab.
 */
export function SettingsDocsSection({
  onOpenGettingStarted,
  onOpenShortcuts,
}: {
  onOpenGettingStarted: () => void
  onOpenShortcuts: () => void
}) {
  return (
    <SettingsSection title="Documentation">
      <SettingsRow
        label="Getting Started"
        description="Learn the basics of BetterC0de"
      >
        <Button variant="outline" size="sm" onClick={onOpenGettingStarted}>
          Open
        </Button>
      </SettingsRow>
      <SettingsRow label="API Reference" description="Full API documentation">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.open("https://github.com/BetterC0de/docs", "_blank")
          }}
        >
          Open
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Keyboard Shortcuts"
        description="View all available shortcuts"
      >
        <Button variant="outline" size="sm" onClick={onOpenShortcuts}>
          Open
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
