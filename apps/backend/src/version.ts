import fs from "node:fs"
import path from "node:path"

const FALLBACK_VERSION = "0.1.0-beta.1"

export function readBackendVersion(): string {
  try {
    const packagePath = path.join(__dirname, "..", "package.json")
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      version?: unknown
    }
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}
