import { Settings2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function UsageSettingsButton() {
  return <Button variant="ghost" size="icon-sm" aria-label="Usage settings" title="Usage settings" onClick={() => {
    window.dispatchEvent(new CustomEvent("betterc0de:open-settings", { detail: { tab: "usage" } }))
  }}><Settings2Icon className="size-4" /></Button>
}
