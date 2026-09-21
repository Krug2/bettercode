import { useState, useCallback, useEffect } from "react"
import { cn } from "@/lib/utils"
import {
  slugifyRuntimeId,
  parseCliArgs,
  stringifyCliArgs,
  parseEnvText,
  stringifyEnv,
} from "@/lib/cli-parse"
import { SettingsSection } from "@/components/settings/atoms"
import {
  deleteRuntimeMcp,
  listRuntimeMcps,
  probeRuntimeMcp,
  saveRuntimeMcp,
  setRuntimeMcpEnabled,
  type RuntimeMcpServer,
} from "@/lib/runtime-config"
import type { ScanResult, McpServer } from "@/lib/onboarding-store"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  PencilIcon,
  Trash2Icon,
  PlusIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Wrench01Icon } from "@hugeicons/core-free-icons"
import { useActiveThread } from "@/lib/chat-store"
import {
  describeCliScanProjectScope,
  resolveCliScanContext,
} from "@/lib/cli-scan-context"

export function SettingsMcpSection() {
  const activeThread = useActiveThread()
  const activeProjectPath =
    activeThread?.worktreePath ?? activeThread?.projectPath ?? null
  const [servers, setServers] = useState<RuntimeMcpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newServer, setNewServer] = useState({
    name: "",
    command: "",
    args: "",
    envText: "",
  })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<
    Record<string, { status: "success" | "error"; message?: string }>
  >({})
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setServers(await listRuntimeMcps())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  const handleAddServer = useCallback(async () => {
    if (!newServer.name.trim() || !newServer.command.trim()) return
    await saveRuntimeMcp({
      id: editingId || slugifyRuntimeId(newServer.name),
      name: newServer.name.trim(),
      command: newServer.command.trim(),
      args: parseCliArgs(newServer.args),
      env: parseEnvText(newServer.envText),
      enabled: true,
    })
    setNewServer({ name: "", command: "", args: "", envText: "" })
    setEditingId(null)
    setShowAddForm(false)
    await refresh()
  }, [editingId, newServer, refresh])

  const toggleServer = useCallback(
    async (id: string, enabled: boolean) => {
      await setRuntimeMcpEnabled(id, enabled)
      await refresh()
    },
    [refresh]
  )

  const removeServer = useCallback(
    async (id: string) => {
      await deleteRuntimeMcp(id)
      setTestResults((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refresh()
    },
    [refresh]
  )

  const editServer = useCallback((server: RuntimeMcpServer) => {
    setEditingId(server.id)
    setNewServer({
      name: server.name,
      command: server.command,
      args: stringifyCliArgs(server.args),
      envText: stringifyEnv(server.env),
    })
    setShowAddForm(true)
  }, [])

  const testConnection = useCallback(async (server: RuntimeMcpServer) => {
    setTestingId(server.id)
    try {
      const result = await probeRuntimeMcp(server)
      setTestResults((prev) => ({
        ...prev,
        [server.id]: result.ok
          ? { status: "success", message: result.note || result.stdout }
          : {
              status: "error",
              message: result.error || result.stderr || result.stdout,
            },
      }))
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { status: "error", message: "Probe failed" },
      }))
    }
    setTestingId(null)
  }, [])

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

      const scannedMcps: McpServer[] = [
        ...(res.claude?.mcpServers || []),
        ...(res.codex?.mcpServers || []),
      ]

      const claudeCount = res.claude?.mcpServers?.length ?? 0
      const codexCount = res.codex?.mcpServers?.length ?? 0
      const parts: string[] = []
      if (claudeFound) parts.push(`${claudeCount} from Claude`)
      if (codexFound) parts.push(`${codexCount} from Codex`)
      const foundSummary =
        `Found ${parts.join(", ")}.${describeCliScanProjectScope(res.projectScope)}`.trim()

      // Refresh current servers to get latest state
      const currentServers = await listRuntimeMcps()
      const existingIds = new Set(currentServers.map((s) => s.id))
      const existingTransports = new Set(
        currentServers.map(mcpTransportIdentity).filter(Boolean)
      )

      const newMcps = scannedMcps.filter((s) => {
        const id = slugifyRuntimeId(s.id || s.name)
        const transport = mcpTransportIdentity(s)
        return (
          !existingIds.has(id) &&
          (!transport || !existingTransports.has(transport))
        )
      })

      let imported = 0
      for (const mcp of newMcps) {
        try {
          await saveRuntimeMcp({
            id: slugifyRuntimeId(mcp.id || mcp.name),
            name: mcp.name,
            command: mcp.command || "",
            args: mcp.args || [],
            env: mcp.env || {},
            headers: mcp.headers || {},
            headerEnv: mcp.headerEnv || {},
            enabled: mcp.enabled !== false,
            type: mcp.type,
            url: mcp.url || null,
            authenticated: mcp.authenticated === true,
          })
          imported++
        } catch {
          // Skip individual failures
        }
      }

      await refresh()

      if (imported > 0) {
        setSyncStatus(
          `${foundSummary} Imported ${imported} new MCP server${imported !== 1 ? "s" : ""}`
        )
      } else {
        setSyncStatus(`${foundSummary} All servers already imported`)
      }
    } catch (err) {
      setSyncStatus(
        err instanceof Error ? err.message : "Sync failed unexpectedly"
      )
    }
    setSyncing(false)
  }, [activeProjectPath, refresh])

  if (loading) {
    return (
      <SettingsSection title="MCP Servers">
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
          MCP Servers
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
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <PlusIcon className="size-3" /> Add MCP Server
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

      {showAddForm && (
        <SettingsSection
          title={editingId ? "Edit MCP Server" : "New MCP Server"}
        >
          <div className="space-y-3 px-4 py-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Server Name
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="My MCP Server"
                value={newServer.name}
                onChange={(e) =>
                  setNewServer({ ...newServer, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Command
              </label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="npx -y @modelcontextprotocol/server-filesystem"
                value={newServer.command}
                onChange={(e) =>
                  setNewServer({ ...newServer, command: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Arguments
              </label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="--port 3000 --verbose"
                value={newServer.args}
                onChange={(e) =>
                  setNewServer({ ...newServer, args: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                Environment Variables
              </label>
              <Textarea
                className="min-h-[60px] font-mono text-xs"
                placeholder="KEY=value&#10;ANOTHER_KEY=value"
                value={newServer.envText}
                onChange={(e) =>
                  setNewServer({ ...newServer, envText: e.target.value })
                }
                rows={3}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false)
                  setEditingId(null)
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAddServer}
                disabled={!newServer.name.trim() || !newServer.command.trim()}
              >
                {editingId ? "Save Server" : "Add Server"}
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}

      {servers.length === 0 && !showAddForm ? (
        <SettingsSection title="Servers">
          <div className="px-6 py-8 text-center">
            <HugeiconsIcon
              icon={Wrench01Icon}
              strokeWidth={2}
              className="mx-auto size-8 text-muted-foreground/30"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              No MCP servers configured
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Add MCP servers to extend tool capabilities
            </p>
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection title="Servers">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  testResults[server.id]?.status === "success"
                    ? "bg-emerald-500"
                    : testResults[server.id]?.status === "error"
                      ? "bg-red-500"
                      : server.enabled
                        ? "bg-amber-500"
                        : "bg-muted-foreground/30"
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{server.name}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                      server.enabled
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {server.enabled ? "active" : "disabled"}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {server.command} {stringifyCliArgs(server.args)}
                </p>
                {testResults[server.id]?.message && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                    {testResults[server.id]?.message}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                disabled={testingId === server.id}
                onClick={() => testConnection(server)}
              >
                {testingId === server.id ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  "Test"
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => editServer(server)}
              >
                <PencilIcon className="size-3.5 text-muted-foreground" />
              </Button>
              <Switch
                checked={server.enabled}
                onCheckedChange={(v) => toggleServer(server.id, v)}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeServer(server.id)}
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

function mcpTransportIdentity(
  server: Pick<McpServer | RuntimeMcpServer, "command" | "args" | "url">
): string {
  const command = server.command?.trim() || ""
  if (command) {
    return `command:${command}\0${(server.args || []).join("\0")}`
  }
  const url = server.url?.trim() || ""
  return url ? `url:${url}` : ""
}
