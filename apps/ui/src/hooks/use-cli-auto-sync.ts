import { useEffect } from "react"
import { resolveCliScanContext } from "@/lib/cli-scan-context"

/**
 * Runs on mount and when the selected project changes to import NEW MCP
 * servers, skills, and agents from Claude/Codex CLI configuration. Project
 * files are included only after the backend trust service approves that root.
 *
 * Best-effort / non-blocking: failures are silently swallowed so the
 * app startup is never delayed or interrupted.
 */
export function useCliAutoSync(activeProjectPath?: string | null) {
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.cliAutoSync) return
    let cancelled = false

    resolveCliScanContext(activeProjectPath)
      .then((scanContext) => api.cliAutoSync(scanContext))
      .then((result) => {
        if (cancelled) return
        if (!result?.ok) return
        const { imported, total, projectScope } = result
        const projectStatus = projectScope?.status ?? "not-selected"
        const any =
          imported.mcpServers > 0 || imported.skills > 0 || imported.agents > 0
        if (any) {
          console.info(
            "[cli-auto-sync] Imported from CLI configs:",
            `${imported.mcpServers} MCP server(s),`,
            `${imported.skills} skill(s),`,
            `${imported.agents} agent(s)`,
            `(scanned ${total.mcpServers} server(s), ${total.skills} skill(s), ${total.agents} agent(s) total)`,
            `(project scope: ${projectStatus})`
          )
        } else {
          console.info(
            "[cli-auto-sync] No new items to import",
            `(scanned ${total.mcpServers} server(s), ${total.skills} skill(s), ${total.agents} agent(s))`,
            `(project scope: ${projectStatus})`
          )
        }
      })
      .catch(() => {
        // Silent — auto-sync is best-effort and must never block startup.
      })
    return () => {
      cancelled = true
    }
  }, [activeProjectPath])
}
