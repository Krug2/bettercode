import { Button } from "@/components/ui/button"
import { assetUrl } from "@/lib/asset-url"
import { useOnboardingStore } from "@/lib/onboarding-store"
import { ChevronRightIcon } from "lucide-react"

export function WelcomeStep() {
  const { nextStep, complete } = useOnboardingStore()
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5 py-8 text-center">
      <img src={assetUrl("favicon.svg")} alt="BetterC0de" className="size-16" />
      <div>
        <h1 className="text-2xl font-bold">Welcome to BetterC0de</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Set up your AI providers, MCP servers, and import existing configs.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={nextStep} className="gap-2">
          Get Started <ChevronRightIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={complete}
        >
          Skip
        </Button>
      </div>
    </div>
  )
}
