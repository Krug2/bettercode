import { getAgentWorkspaceTrust } from "@/services/backend"

export interface CliScanContext {
  projectPath: string
  workspaceTrusted: boolean
}

export interface CliScanProjectScope {
  status: "not-selected" | "invalid" | "unavailable" | "untrusted" | "trusted"
  projectPath: string | null
  workspaceTrusted: boolean
}

type WorkspaceTrustLookup = typeof getAgentWorkspaceTrust

/**
 * Resolve the renderer's selected workspace against the backend-owned trust
 * record. A lookup failure keeps the project selected but fails closed so the
 * shell scans user-global CLI configuration only.
 */
export async function resolveCliScanContext(
  projectPath: string | null | undefined,
  lookup: WorkspaceTrustLookup = getAgentWorkspaceTrust
): Promise<CliScanContext | undefined> {
  const selectedProjectPath = projectPath?.trim()
  if (!selectedProjectPath) return undefined

  try {
    const { trust } = await lookup(selectedProjectPath)
    return {
      projectPath: trust.workspacePath.trim() || selectedProjectPath,
      workspaceTrusted: trust.state === "trusted",
    }
  } catch {
    return {
      projectPath: selectedProjectPath,
      workspaceTrusted: false,
    }
  }
}

export function describeCliScanProjectScope(
  scope: CliScanProjectScope | null | undefined
): string {
  switch (scope?.status) {
    case "not-selected":
      return " User config only; no project is selected."
    case "invalid":
      return " User config only; the selected project path is invalid."
    case "unavailable":
      return " User config only; the selected project is unavailable."
    case "untrusted":
      return " User config only; project config was skipped because the workspace is untrusted."
    default:
      return ""
  }
}
