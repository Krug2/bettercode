/**
 * Top-level settings dialog.
 *
 * Each tab renders a dedicated section component (see `./rules-section.tsx`,
 * `./skills-section.tsx`, etc.). The modal itself owns only the shell
 * chrome (tab nav, scroll container, Getting Started + Keyboard Shortcuts
 * sub-dialogs, Reset confirmation).
 */

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/components/theme-provider"
import { useAppearanceStore } from "@/lib/appearance-store"
import { useSettingsStore } from "@/lib/settings-store"
import { DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { HugeiconsIcon } from "@hugeicons/react"
import { SettingsRulesSection } from "@/components/settings/rules-section"
import { SettingsSkillsSection } from "@/components/settings/skills-section"
import { SettingsMcpSection } from "@/components/settings/mcp-section"
import { SettingsCodeSearchSection } from "@/components/settings/code-search-section"
import { SettingsOrchestratorSection } from "@/components/settings/orchestrator-section"
import { SettingsHooksSection } from "@/components/settings/hooks-section"
import { SettingsPermissionsSection } from "@/components/settings/permission-rules-section"
import { SettingsProvidersSection } from "@/components/settings/providers-section"
import { SettingsModelVisibilitySection } from "@/components/settings/model-visibility-section"
import { SettingsAppearanceSection } from "@/components/settings/appearance-section"
import { SettingsPluginsSection } from "@/components/settings/plugins-section"
import { GettingStartedDialog } from "@/components/settings/getting-started-dialog"
import { ResetSettingsDialog } from "@/components/settings/reset-settings-dialog"
import { KeyboardShortcutsDialog } from "@/components/settings/keyboard-shortcuts-dialog"
import { settingsTabs } from "@/components/settings/settings-tabs"
import { SettingsGeneralSection } from "@/components/settings/general-section"
import { SettingsDocsSection } from "@/components/settings/docs-section"
import { SettingsBetterC0deSection } from "@/components/settings/betterc0de-section"
import { SettingsRemoteAccessSection } from "@/components/settings/remote-access-section"
import { SettingsDevicesSection } from "@/components/settings/devices-section"

export function SettingsModal({ defaultTab = "general" }: { defaultTab?: string }) {
  const { theme, setTheme } = useTheme()
  const settings = useSettingsStore()
  const { init: initSettings, refreshCli } = settings
  const isSimple = useAppearanceStore((s) => s.chatUiStyle === "simple")
  const [gettingStartedOpen, setGettingStartedOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  useEffect(() => {
    initSettings()
    refreshCli()
  }, [initSettings, refreshCli])

  return (
    <DialogContent
      showCloseButton={false}
      className={cn(
        "max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 ring-0! duration-200 data-open:slide-in-from-bottom-4 data-open:zoom-in-[0.98] data-closed:slide-out-to-bottom-4 data-closed:zoom-out-[0.98]",
        isSimple ? "h-[1080px] sm:max-w-[1400px]" : "h-[1280px] sm:max-w-[1640px]"
      )}
      style={{ fontSize: "16px", borderRadius: "var(--radius-xl, 0.875rem)" }}
    >
      <DialogTitle className="sr-only">Settings</DialogTitle>
      <Tabs
        defaultValue={defaultTab}
        orientation="vertical"
        className="flex h-full min-h-0 gap-0 overflow-hidden"
      >
        {/* Tab nav */}
        <div className={cn(
          "flex min-h-0 shrink-0 flex-col overflow-y-auto border-r border-border/40 bg-muted/20",
          isSimple ? "w-[272px] p-4" : "w-[320px] p-5"
        )}>
          <h2 className={cn("font-semibold", isSimple ? "px-3 pb-4 text-lg" : "px-4 pb-5 text-xl")}>Settings</h2>
          <TabsList
            variant="line"
            className="shrink-0 flex-col items-stretch gap-1 bg-transparent p-0 [&_[data-slot=tabs-trigger]]:after:hidden"
          >
            {settingsTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  "justify-start",
                  isSimple ? "gap-3 rounded-lg px-3 py-2.5 text-sm" : "gap-3.5 rounded-xl px-4 py-3.5 text-[15px]"
                )}
              >
                <HugeiconsIcon
                  icon={tab.icon}
                  strokeWidth={2}
                  className={isSimple ? "size-[18px]" : "size-5"}
                />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Content */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {settingsTabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="absolute inset-0 mt-0 data-[state=active]:animate-in data-[state=active]:duration-150 data-[state=active]:fade-in-0 data-[state=inactive]:hidden"
            >
              <div className="h-full overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-40px),transparent)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className={cn(isSimple ? "space-y-4 px-6 py-5" : "space-y-6 px-8 py-7")}>
                  <div>
                    <h3 className={cn("font-semibold", isSimple ? "text-lg" : "text-xl")}>{tab.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tab.description}
                    </p>
                  </div>

                  {tab.id === "general" && (
                    <SettingsGeneralSection
                      theme={theme}
                      setTheme={setTheme}
                      onOpenResetConfirm={() => setResetConfirmOpen(true)}
                    />
                  )}
                  {tab.id === "appearance" && <SettingsAppearanceSection />}
                  {tab.id === "models" && (
                    <>
                      <SettingsProvidersSection />
                      <SettingsModelVisibilitySection />
                    </>
                  )}
                  {tab.id === "plugins" && <SettingsPluginsSection />}
                  {tab.id === "rules" && <SettingsRulesSection />}
                  {tab.id === "skills" && <SettingsSkillsSection />}
                  {tab.id === "tools" && <SettingsMcpSection />}
                  {tab.id === "experimental" && <><SettingsOrchestratorSection /><SettingsCodeSearchSection /></>}
                  {tab.id === "hooks" && <SettingsHooksSection />}
                  {tab.id === "remote" && <SettingsRemoteAccessSection />}
                  {tab.id === "devices" && <SettingsDevicesSection />}
                  {tab.id === "permissions" && <SettingsPermissionsSection />}
                  {tab.id === "betterc0de" && <SettingsBetterC0deSection />}
                  {tab.id === "docs" && (
                    <>
                      <SettingsDocsSection
                        onOpenGettingStarted={() => setGettingStartedOpen(true)}
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                      />
                      <GettingStartedDialog
                        open={gettingStartedOpen}
                        onOpenChange={setGettingStartedOpen}
                        isSimple={isSimple}
                      />
                      <ResetSettingsDialog
                        open={resetConfirmOpen}
                        onOpenChange={setResetConfirmOpen}
                        isSimple={isSimple}
                      />
                      <KeyboardShortcutsDialog
                        open={shortcutsOpen}
                        onOpenChange={setShortcutsOpen}
                        isSimple={isSimple}
                      />
                    </>
                  )}
                </div>
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </DialogContent>
  )
}
