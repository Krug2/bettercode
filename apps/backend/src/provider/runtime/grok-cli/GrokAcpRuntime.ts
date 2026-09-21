import {
  buildGrokAcpSpawnInput,
  type GrokAcpRuntimeSettings,
} from "./GrokAcpSupport"
import {
  createAcpRuntime,
  type AcpEvent,
  type AcpExit,
  type AcpMode,
  type AcpModeState,
  type AcpPermissionRequest,
  type AcpPlanUpdate,
  type AcpRuntime,
  type AcpRuntimeOptions,
  type AcpRuntimeProfile,
  type AcpSessionSetupResult,
  type AcpStarted,
  type AcpToolCallState,
} from "../acp/AcpRuntimeBase"

/**
 * xAI Grok Build's `grok agent stdio` runtime. The protocol machinery lives
 * in `acp/AcpRuntimeBase`; this file only declares what Grok does differently
 * on the wire.
 */

export type GrokAcpMode = AcpMode
export type GrokAcpModeState = AcpModeState
export type GrokAcpStarted = AcpStarted
export type GrokAcpSessionSetupResult = AcpSessionSetupResult
export type GrokAcpToolCallState = AcpToolCallState
export type GrokAcpPlanUpdate = AcpPlanUpdate
export type GrokAcpPermissionRequest = AcpPermissionRequest
export type GrokAcpExit = AcpExit
export type GrokAcpEvent = AcpEvent
export type GrokAcpRuntime = AcpRuntime
export type GrokAcpRuntimeOptions = AcpRuntimeOptions<GrokAcpRuntimeSettings>

// Plain ACP client capabilities — no Cursor `_meta.parameterizedModelPicker`
// extension; Grok Build advertises its model picker through the standard
// session config options.
const GROK_CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
} as const

export function grokAuthError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Grok CLI is not authenticated. Run \`grok login\` (or set XAI_API_KEY) and try again. (${detail})`
  )
}

export const GROK_RUNTIME_PROFILE: AcpRuntimeProfile<GrokAcpRuntimeSettings> = {
  label: "Grok",
  buildSpawnInput: buildGrokAcpSpawnInput,
  clientCapabilities: GROK_CLIENT_CAPABILITIES,
  // Unlike Cursor (which requires an unconditional `authenticate`
  // round-trip), a logged-in Grok CLI serves sessions directly. We only fall
  // back to `authenticate` when session setup reports an auth error.
  auth: { strategy: "lazy", toAuthError: grokAuthError },
}

export function createGrokAcpRuntime(
  options: GrokAcpRuntimeOptions
): GrokAcpRuntime {
  return createAcpRuntime(GROK_RUNTIME_PROFILE, options)
}
