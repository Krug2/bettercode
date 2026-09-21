import { listDirectoryFs } from "@/services/backend/filesystem"
import { readFile } from "@/services/backend/workspaceApi"

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm"

export async function detectDevServerProject(projectPath: string): Promise<{
  scriptName: string | null
  packageManager: PackageManager
}> {
  // Missing lockfiles are normal. Reading each candidate still produces a
  // browser network error even when the transport suppresses its own logging.
  const directory = await listDirectoryFs(projectPath)
  if (directory.truncated) {
    throw new Error("The project file listing is incomplete. Dev server settings could not be detected.")
  }
  const files = new Set(
    directory.entries.filter((entry) => !entry.isDir).map((entry) => entry.name)
  )
  const packageManager = files.has("pnpm-lock.yaml") ? "pnpm"
    : files.has("yarn.lock") ? "yarn"
      : files.has("bun.lock") || files.has("bun.lockb") ? "bun" : "npm"
  let scriptName: string | null = null
  if (files.has("package.json")) {
    const pkg = await readFile(`${projectPath}/package.json`)
    const parsed: unknown = JSON.parse(pkg.content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("package.json must contain a JSON object.")
    }
    const scripts = "scripts" in parsed ? parsed.scripts : null
    if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
      scriptName = ["dev", "start", "serve"].find((name) =>
        typeof (scripts as Record<string, unknown>)[name] === "string"
      ) ?? null
    }
  }
  return { scriptName, packageManager }
}
