import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useOnboardingStore } from "@/lib/onboarding-store"
import {
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  DownloadIcon,
  SearchIcon,
} from "lucide-react"
import { StepHeader, ItemIcon, MARKETPLACE } from "./shared"

export function MarketplaceStep() {
  const { nextStep, prevStep } = useOnboardingStore()
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<"all" | "provider" | "mcp" | "skill">("all")

  const filtered = MARKETPLACE.filter((item) => {
    if (tab !== "all" && item.category !== tab) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()))
      return false
    return true
  })

  return (
    <div className="w-full max-w-3xl">
      <StepHeader
        title="Marketplace"
        description="Install AI providers, MCP servers, and skills."
      />

      {/* Search + Tabs */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers, MCP, skills..."
            className="h-9 w-full rounded-lg border border-border bg-transparent pr-3 pl-9 text-sm outline-none focus:border-ring"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "provider", "mcp", "skill"] as const).map((t) => (
            <Button
              key={t}
              variant={tab === t ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-3 text-xs capitalize"
              onClick={() => setTab(t)}
            >
              {t === "all"
                ? `All (${MARKETPLACE.length})`
                : t === "mcp"
                  ? "MCP"
                  : t + "s"}
            </Button>
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div className="max-h-[48vh] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground/50">
            No results for "{search}"
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {filtered.map((item) => {
              const isInstalled = installed.has(item.id)
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col rounded-xl border p-3 transition-colors",
                    isInstalled
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/50 hover:border-border"
                  )}
                >
                  <div className="mb-2 flex items-start gap-2.5">
                    <ItemIcon icon={item.icon} category={item.category} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">
                        {item.name}
                      </p>
                      <Badge
                        variant="outline"
                        className="mt-0.5 px-1 py-0 text-[8px]"
                      >
                        {item.category === "provider"
                          ? "Provider"
                          : item.category === "mcp"
                            ? "MCP"
                            : "Skill"}
                      </Badge>
                    </div>
                  </div>

                  <p className="line-clamp-2 flex-1 text-[10px] text-muted-foreground">
                    {item.description}
                  </p>

                  <div className="mt-2 flex items-center gap-1.5 text-[9px] text-muted-foreground/40">
                    {item.source && (
                      <span className="truncate">{item.source}</span>
                    )}
                    {item.installs && item.source && <span>·</span>}
                    {item.installs && (
                      <span className="shrink-0">
                        {item.installs >= 1000
                          ? `${Math.round(item.installs / 1000)}K`
                          : item.installs}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5">
                    {isInstalled ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-full gap-1.5 text-[10px]"
                        disabled
                      >
                        <CheckIcon className="size-3" /> Installed
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-full gap-1.5 text-[10px]"
                        onClick={() =>
                          setInstalled((p) => {
                            const n = new Set(p)
                            n.add(item.id)
                            return n
                          })
                        }
                      >
                        <DownloadIcon className="size-3" /> Install
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => window.open("https://skills.sh", "_blank")}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 py-2.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        Browse 91,000+ more on skills.sh <ChevronRightIcon className="size-3" />
      </button>

      <div className="mt-3 flex items-center gap-2">
        <p className="text-[10px] text-muted-foreground/40">
          {filtered.length} items · {installed.size} installed
        </p>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={prevStep}>
          <ChevronLeftIcon className="mr-1 size-3.5" />
          Back
        </Button>
        <Button size="sm" className="gap-1" onClick={nextStep}>
          Next <ChevronRightIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
