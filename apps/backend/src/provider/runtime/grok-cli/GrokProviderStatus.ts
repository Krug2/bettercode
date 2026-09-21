import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveGrokBinaryAsync } from "./GrokBinaryResolution"
import { readGrokMetadataFile, readGrokMetadataFileAsync } from "./GrokMetadataFile"
import { sanitizedChildEnvironment } from "../../../security/childEnvironment"
import { terminateProviderChildProcessTree } from "../ChildProcessTermination"

export interface GrokProviderAuth {
  readonly status: "authenticated" | "unauthenticated" | "unknown"
  readonly type?: string
  readonly label?: string
}

export interface GrokProviderStatusProbe {
  readonly installed: boolean
  readonly configured: boolean
  readonly binaryPath: string | null
  readonly version: string | null
  readonly status: "ready" | "warning" | "error"
  readonly auth: GrokProviderAuth
  readonly message?: string
}

const VERSION_CACHE_TTL_MS = 5 * 60 * 1000
let versionCache: { binaryPath: string; version: string | null; ts: number } | null =
  null
let versionProbeInFlight: { binaryPath: string; promise: Promise<string | null> } | null = null
let retainedVersionChild: ChildProcess | null = null

export async function probeGrokProviderStatusAsync(input: {
  readonly binaryPath?: string | null
  readonly env?: NodeJS.ProcessEnv
}): Promise<GrokProviderStatusProbe> {
  const resolved = await resolveGrokBinaryAsync(input.binaryPath)
  if (!resolved) {
    return {
      installed: false,
      configured: false,
      binaryPath: null,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message:
        "xAI Grok CLI not found. Install it via `irm https://x.ai/cli/install.ps1 | iex` (a PATH `grok` from another package is deliberately ignored).",
    }
  }
  const [version, auth] = await Promise.all([
    cachedVersionAsync(resolved.binaryPath),
    detectGrokAuthAsync(input.env ?? process.env),
  ])
  return auth.status === "authenticated"
    ? {
        installed: true,
        configured: true,
        binaryPath: resolved.binaryPath,
        version,
        status: "ready",
        auth,
      }
    : {
        installed: true,
        configured: true,
        binaryPath: resolved.binaryPath,
        version,
        status: "ready",
        auth: { status: "unknown" },
        message:
          "Could not verify Grok CLI login — run `grok login` (or set XAI_API_KEY) if sends fail.",
      }
}

export function detectGrokAuth(env: NodeJS.ProcessEnv): GrokProviderAuth {
  const grokDir = path.join(os.homedir(), ".grok")
  for (const file of ["credentials.json", "auth.json"]) {
    if (fileExists(path.join(grokDir, file))) {
      return { status: "authenticated", type: "oauth", label: "Grok CLI Login" }
    }
  }
  // Cheap line scan of config.toml for key/token entries — deliberately no
  // TOML parser dependency for a heuristic.
  const configToml = readGrokMetadataFile(path.join(grokDir, "config.toml"))
  if (configToml && /^\s*(api_key|token|auth_token)\s*=\s*\S/m.test(configToml)) {
    return { status: "authenticated", type: "api-key", label: "Grok config key" }
  }
  if (env.XAI_API_KEY?.trim()) {
    return { status: "authenticated", type: "api-key", label: "XAI_API_KEY" }
  }
  return { status: "unknown" }
}

export async function detectGrokAuthAsync(
  env: NodeJS.ProcessEnv
): Promise<GrokProviderAuth> {
  const grokDir = path.join(os.homedir(), ".grok")
  for (const file of ["credentials.json", "auth.json"]) {
    if (await fileExistsAsync(path.join(grokDir, file))) {
      return {
        status: "authenticated",
        type: "oauth",
        label: "Grok CLI Login",
      }
    }
  }
  const configToml = await readGrokMetadataFileAsync(path.join(grokDir, "config.toml"))
  if (
    configToml &&
    /^\s*(api_key|token|auth_token)\s*=\s*\S/m.test(configToml)
  ) {
    return {
      status: "authenticated",
      type: "api-key",
      label: "Grok config key",
    }
  }
  if (env.XAI_API_KEY?.trim()) {
    return {
      status: "authenticated",
      type: "api-key",
      label: "XAI_API_KEY",
    }
  }
  return { status: "unknown" }
}

async function cachedVersionAsync(binaryPath: string): Promise<string | null> {
  if (
    versionCache &&
    versionCache.binaryPath === binaryPath &&
    Date.now() - versionCache.ts < VERSION_CACHE_TTL_MS
  ) {
    return versionCache.version
  }
  // One optional probe at a time. Another binary must never inherit its version.
  if (versionProbeInFlight) {
    return versionProbeInFlight.binaryPath === binaryPath ? versionProbeInFlight.promise : null
  }
  const probe = (async () => {
    if (retainedVersionChild) {
      if (process.platform === "win32" &&
        (retainedVersionChild.exitCode != null || retainedVersionChild.signalCode != null)) {
        // Its PID no longer safely identifies the unconfirmed descendant tree.
        return null
      }
      try {
        await terminateProviderChildProcessTree(retainedVersionChild)
        retainedVersionChild = null
      } catch {
        return null
      }
    }
    return probeVersionAsync(binaryPath)
  })().then((version) => {
    if (!retainedVersionChild) versionCache = { binaryPath, version, ts: Date.now() }
    return version
  })
  versionProbeInFlight = { binaryPath, promise: probe }
  try {
    return await probe
  } finally {
    if (versionProbeInFlight?.promise === probe) versionProbeInFlight = null
  }
}

function probeVersionAsync(binaryPath: string): Promise<string | null> {
  // Never launch a cmd/PowerShell shim from an unattended probe. The shim can
  // outlive its wrapper on timeout; installed status remains authoritative and
  // the version is optional.
  if (process.platform === "win32" && !/\.exe$/i.test(binaryPath)) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ["--version"], {
      env: sanitizedChildEnvironment(),
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let outputBytes = 0
    let settled = false
    let terminating = false
    const finish = (successful = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const version =
        /(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)/i.exec(output)?.[1] ?? null
      resolve(successful ? version : null)
    }
    const beginTermination = () => {
      if (settled || terminating) return
      terminating = true
      clearTimeout(timer)
      void terminateProviderChildProcessTree(child).then(
        () => finish(),
        () => {
          // Keep ownership; the next probe must retry cleanup before spawning.
          retainedVersionChild = child
          finish()
        },
      )
    }
    const append = (chunk: unknown) => {
      if (settled || terminating) return
      const text = String(chunk)
      outputBytes += Buffer.byteLength(text)
      if (outputBytes > 64 * 1024) beginTermination()
      else output += text
    }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)
    child.once("error", () => { if (!terminating) finish() })
    child.once("close", (code) => { if (!terminating) finish(code === 0) })
    const timer = setTimeout(beginTermination, 3_000)
    timer.unref?.()
  })
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)).isFile()
  } catch {
    return false
  }
}
