import { access } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const remotionDir = path.join(root, "remotion")

try {
  await access(remotionDir, fsConstants.R_OK)
} catch {
  console.log("[remotion] optional project is not present; skipping its typecheck")
  process.exit(0)
}

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc")
const result = spawnSync(process.execPath, [tsc, "--noEmit", "-p", "tsconfig.remotion.json"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
})

if (result.error) {
  console.error("[remotion] typecheck failed to start: " + result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
