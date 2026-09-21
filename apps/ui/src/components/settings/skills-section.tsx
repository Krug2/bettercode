import { useState, useCallback, useEffect } from "react"
import { slugifyRuntimeId } from "@/lib/cli-parse"
import { SettingsSection } from "@/components/settings/atoms"
import {
  deleteRuntimeSkill,
  deleteRuntimeSubagent,
  listRuntimeSkills,
  listRuntimeSubagents,
  saveRuntimeSkill,
  saveRuntimeSubagent,
  type RuntimeSkill,
  type RuntimeSubagent,
} from "@/lib/runtime-config"
import type { ScanResult } from "@/lib/onboarding-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Trash2Icon,
  BrainIcon,
  PlusIcon,
  Loader2Icon,
  FolderOpenIcon,
  RefreshCwIcon,
} from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { MagicWand01Icon } from "@hugeicons/core-free-icons"
import { useActiveThread } from "@/lib/chat-store"
import {
  describeCliScanProjectScope,
  resolveCliScanContext,
} from "@/lib/cli-scan-context"

export function SettingsSkillsSection() {
  const activeThread = useActiveThread()
  const activeProjectPath =
    activeThread?.worktreePath ?? activeThread?.projectPath ?? null
  const [skills, setSkills] = useState<RuntimeSkill[]>([])
  const [subagents, setSubagents] = useState<RuntimeSubagent[]>([])
  const [loading, setLoading] = useState(true)
  const [showSkillForm, setShowSkillForm] = useState(false)
  const [showSubagentForm, setShowSubagentForm] = useState(false)
  const [newSkill, setNewSkill] = useState({
    name: "",
    description: "",
    version: "1.0.0",
    content: "",
  })
  const [newSubagent, setNewSubagent] = useState({
    name: "",
    description: "",
    prompt: "",
  })
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSkills, nextSubagents] = await Promise.all([
        listRuntimeSkills(),
        listRuntimeSubagents(),
      ])
      setSkills(nextSkills)
      setSubagents(nextSubagents)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  const handleAddSkill = useCallback(async () => {
    if (!newSkill.name.trim()) return
    const id = slugifyRuntimeId(newSkill.name)
    const content =
      newSkill.content.trim() ||
      `# ${newSkill.name.trim()}\n\n## Description\n${newSkill.description.trim() || "Describe what this skill does."}\n`
    await saveRuntimeSkill({
      id,
      name: newSkill.name.trim(),
      description: newSkill.description.trim(),
      version: newSkill.version.trim() || "1.0.0",
      enabled: true,
      isPublic: false,
      content,
    })
    setNewSkill({
      name: "",
      description: "",
      version: "1.0.0",
      content: "",
    })
    setShowSkillForm(false)
    await refresh()
  }, [newSkill, refresh])

  const toggleSkill = useCallback(
    async (skill: RuntimeSkill, enabled: boolean) => {
      await saveRuntimeSkill({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        isPublic: skill.public,
        enabled,
        content: skill.content,
        source: skill.source,
        sourceUrl: skill.sourceUrl,
        sourcePath: skill.sourcePath,
        providerKinds: skill.providerKinds,
        providerInstanceIds: skill.providerInstanceIds,
      })
      await refresh()
    },
    [refresh]
  )

  const removeSkill = useCallback(
    async (id: string) => {
      await deleteRuntimeSkill(id)
      await refresh()
    },
    [refresh]
  )

  const handleAddSubagent = useCallback(async () => {
    if (!newSubagent.name.trim() || !newSubagent.prompt.trim()) return
    await saveRuntimeSubagent({
      id: slugifyRuntimeId(newSubagent.name),
      name: newSubagent.name.trim(),
      description: newSubagent.description.trim(),
      prompt: newSubagent.prompt.trim(),
      enabled: true,
      source: "local",
    })
    setNewSubagent({ name: "", description: "", prompt: "" })
    setShowSubagentForm(false)
    await refresh()
  }, [newSubagent, refresh])

  const toggleSubagent = useCallback(
    async (subagent: RuntimeSubagent, enabled: boolean) => {
      await saveRuntimeSubagent({
        id: subagent.id,
        name: subagent.name,
        description: subagent.description,
        prompt: subagent.prompt,
        enabled,
        source: subagent.source,
        sourcePath: subagent.sourcePath,
      })
      await refresh()
    },
    [refresh]
  )

  const removeSubagent = useCallback(
    async (id: string) => {
      await deleteRuntimeSubagent(id)
      await refresh()
    },
    [refresh]
  )

  const syncFromCli = useCallback(async () => {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const scanContext = await resolveCliScanContext(activeProjectPath)
      const res = (await window.electronAPI?.onboardingScan(scanContext)) as
        | {
            ok?: boolean
            claude: ScanResult["claude"]
            codex: ScanResult["codex"]
            projectScope?: ScanResult["projectScope"]
          }
        | undefined

      if (!res) {
        setSyncStatus("Electron API not available")
        setSyncing(false)
        return
      }

      const claudeFound = res.claude?.found ?? false
      const codexFound = res.codex?.found ?? false

      if (!claudeFound && !codexFound) {
        setSyncStatus("Claude CLI and Codex CLI not found")
        setSyncing(false)
        return
      }

      const scannedSkills = [
        ...(res.claude?.skills || []),
        ...(res.codex?.skills || []),
      ]
      const scannedAgents = res.codex?.agents || []

      const claudeSkillCount = res.claude?.skills?.length ?? 0
      const codexSkillCount = res.codex?.skills?.length ?? 0
      const agentCount = scannedAgents.length
      const parts: string[] = []
      if (claudeFound)
        parts.push(
          `${claudeSkillCount} skill${claudeSkillCount !== 1 ? "s" : ""} from Claude`
        )
      if (codexFound)
        parts.push(
          `${codexSkillCount} skill${codexSkillCount !== 1 ? "s" : ""} from Codex`
        )
      if (agentCount > 0)
        parts.push(
          `${agentCount} agent${agentCount !== 1 ? "s" : ""} from Codex`
        )
      const foundSummary =
        `Found ${parts.join(", ")}.${describeCliScanProjectScope(res.projectScope)}`.trim()

      // Refresh to get latest state
      const [currentSkills, currentSubagents] = await Promise.all([
        listRuntimeSkills(),
        listRuntimeSubagents(),
      ])
      const existingSkillIds = new Set(currentSkills.map((s) => s.id))
      const existingSubagentIds = new Set(currentSubagents.map((s) => s.id))

      const newSkills = scannedSkills.filter((skill) => {
        const id = slugifyRuntimeId(skill.id || skill.name)
        return !existingSkillIds.has(id)
      })

      const newAgents = scannedAgents.filter((agent) => {
        const id = slugifyRuntimeId(agent.id || agent.name)
        return !existingSubagentIds.has(id)
      })

      let importedSkills = 0
      let importedAgents = 0
      if (newSkills.length > 0 || newAgents.length > 0) {
        try {
          const importResult = (await window.electronAPI?.onboardingImport?.({
            mcpServers: [],
            plugins: [],
            skills: newSkills,
            agents: newAgents,
          })) as { ok?: boolean; error?: string } | undefined
          if (!importResult) {
            throw new Error("Onboarding import API is unavailable")
          }
          if (!importResult.ok) {
            throw new Error(importResult.error || "Failed to import CLI skills")
          }
          importedSkills = newSkills.length
          importedAgents = newAgents.length
        } catch {
          for (const skill of newSkills) {
            try {
              await saveRuntimeSkill({
                id: slugifyRuntimeId(skill.id || skill.name),
                name: skill.name,
                description: `Imported from ${skill.source || "CLI"}`,
                version: "1.0.0",
                isPublic: false,
                enabled: true,
                content: "",
                source: skill.source || "import",
                sourcePath: skill.path,
                providerKinds: skill.providerKinds,
                providerInstanceIds: skill.providerInstanceIds,
              })
              importedSkills++
            } catch {
              // Skip individual failures
            }
          }
        }
      }

      if (newAgents.length > 0 && importedAgents === 0) {
        for (const agent of newAgents) {
          try {
            await saveRuntimeSubagent({
              id: slugifyRuntimeId(agent.id || agent.name),
              name: agent.name,
              description: `Imported from ${agent.source || "Codex"}`,
              prompt: "",
              enabled: true,
              source: agent.source || "codex",
            })
            importedAgents++
          } catch {
            // Skip individual failures
          }
        }
      }

      await refresh()

      const total = importedSkills + importedAgents
      if (total > 0) {
        const imported: string[] = []
        if (importedSkills > 0)
          imported.push(
            `${importedSkills} skill${importedSkills !== 1 ? "s" : ""}`
          )
        if (importedAgents > 0)
          imported.push(
            `${importedAgents} agent${importedAgents !== 1 ? "s" : ""}`
          )
        setSyncStatus(`${foundSummary} Imported ${imported.join(" and ")}`)
      } else {
        setSyncStatus(`${foundSummary} All items already imported`)
      }
    } catch (err) {
      setSyncStatus(
        err instanceof Error ? err.message : "Sync failed unexpectedly"
      )
    }
    setSyncing(false)
  }, [activeProjectPath, refresh])

  const openRuntimeFolder = useCallback(async (relative: string) => {
    const info = await window.electronAPI?.getAppInfo?.()
    if (!info?.baseDir) return
    await window.electronAPI?.openPath?.(
      `${info.baseDir.replace(/\\/g, "/")}/${relative}`
    )
  }, [])

  if (loading) {
    return (
      <SettingsSection title="Skills & Subagents">
        <div className="px-6 py-8 text-center">
          <Loader2Icon className="mx-auto size-5 animate-spin text-muted-foreground" />
        </div>
      </SettingsSection>
    )
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Runtime Registries
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={syncing}
            onClick={syncFromCli}
          >
            {syncing ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            Sync from CLI
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowSkillForm((value) => !value)}
          >
            <PlusIcon className="size-3" /> Add Skill
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowSubagentForm((value) => !value)}
          >
            <PlusIcon className="size-3" /> Add Subagent
          </Button>
        </div>
      </div>

      {syncStatus && (
        <div className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {syncStatus}
          <button
            className="ml-2 text-muted-foreground/60 hover:text-foreground"
            onClick={() => setSyncStatus(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {showSkillForm && (
        <SettingsSection title="New Skill">
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Name
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="My Skill"
                value={newSkill.name}
                onChange={(e) =>
                  setNewSkill({ ...newSkill, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Description
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="What this skill does"
                value={newSkill.description}
                onChange={(e) =>
                  setNewSkill({ ...newSkill, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Version
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="1.0.0"
                value={newSkill.version}
                onChange={(e) =>
                  setNewSkill({ ...newSkill, version: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Markdown Content
              </label>
              <Textarea
                className="min-h-[140px] font-mono text-xs"
                placeholder="# My Skill&#10;&#10;## Description&#10;Explain when this skill should be applied..."
                value={newSkill.content}
                onChange={(e) =>
                  setNewSkill({ ...newSkill, content: e.target.value })
                }
                rows={8}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSkillForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAddSkill}
                disabled={!newSkill.name.trim()}
              >
                Add Skill
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      {showSubagentForm && (
        <SettingsSection title="New Subagent">
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Name
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="Repository Analyst"
                value={newSubagent.name}
                onChange={(e) =>
                  setNewSubagent({ ...newSubagent, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Description
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="What this subagent is responsible for"
                value={newSubagent.description}
                onChange={(e) =>
                  setNewSubagent({
                    ...newSubagent,
                    description: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Prompt
              </label>
              <Textarea
                className="min-h-[140px] font-mono text-xs"
                placeholder="You are a focused subagent. Your scope is..."
                value={newSubagent.prompt}
                onChange={(e) =>
                  setNewSubagent({ ...newSubagent, prompt: e.target.value })
                }
                rows={8}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSubagentForm(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAddSubagent}
                disabled={
                  !newSubagent.name.trim() || !newSubagent.prompt.trim()
                }
              >
                Add Subagent
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      {skills.length === 0 && !showSkillForm ? (
        <SettingsSection title="Skills">
          <div className="px-6 py-8 text-center">
            <HugeiconsIcon
              icon={MagicWand01Icon}
              strokeWidth={2}
              className="mx-auto size-8 text-muted-foreground/30"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              No runtime skills configured
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Create or import skills to extend prompt behavior
            </p>
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection title="Skills">
          {skills.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{skill.name}</span>
                  <Badge variant="outline" className="text-[9px]">
                    v{skill.version}
                  </Badge>
                </div>
                {(skill.description || skill.source) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {skill.description || skill.source}
                  </p>
                )}
              </div>
              <Switch
                checked={skill.enabled}
                onCheckedChange={(value) => toggleSkill(skill, value)}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => openRuntimeFolder(`skills/${skill.id}`)}
              >
                <FolderOpenIcon className="size-3.5 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeSkill(skill.id)}
              >
                <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </SettingsSection>
      )}

      {subagents.length === 0 && !showSubagentForm ? (
        <SettingsSection title="Subagents">
          <div className="px-6 py-8 text-center">
            <BrainIcon className="mx-auto size-8 text-muted-foreground/30" />
            <p className="mt-2 text-sm text-muted-foreground">
              No subagents configured
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Add reusable subagent prompts that can be referenced from chat
            </p>
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection title="Subagents">
          {subagents.map((subagent) => (
            <div
              key={subagent.id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{subagent.name}</span>
                  {subagent.source && (
                    <Badge variant="outline" className="text-[9px]">
                      {subagent.source}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {subagent.description || subagent.prompt}
                </p>
              </div>
              <Switch
                checked={subagent.enabled}
                onCheckedChange={(value) => toggleSubagent(subagent, value)}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => openRuntimeFolder(`subagents/${subagent.id}`)}
              >
                <FolderOpenIcon className="size-3.5 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeSubagent(subagent.id)}
              >
                <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </SettingsSection>
      )}
    </>
  )
}
