import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  defaultInstanceIdForDriver,
  normalizeProviderDriverKind,
} from "@/lib/provider-instances"

export const PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY =
  "betterc0de:provider-update-dismissals:v1"

export type ProviderUpdateCandidate = ProviderInstanceSnapshot & {
  readonly versionAdvisory: NonNullable<
    ProviderInstanceSnapshot["versionAdvisory"]
  > & {
    readonly status: "behind_latest"
    readonly latestVersion: string
  }
}

export type ProviderUpdateViewTone = "warning" | "loading" | "error" | "success"

export type ProviderUpdateViewPhase =
  | "initial"
  | "running"
  | "failed"
  | "unchanged"
  | "succeeded"

export interface ProviderUpdateView {
  readonly phase: ProviderUpdateViewPhase
  readonly tone: ProviderUpdateViewTone
  readonly title: string
  readonly description: string
  readonly dismissAfterVisibleMs?: number
}

export type ProviderUpdateSidebarPillTone =
  | "loading"
  | "warning"
  | "error"
  | "success"

export interface ProviderUpdateSidebarPillView {
  readonly key: string
  readonly tone: ProviderUpdateSidebarPillTone
  readonly title: string
  readonly description: string
  readonly dismissible?: boolean
  readonly dismissAfterVisibleMs?: number
}

interface ProviderUpdateSidebarPillOptions {
  readonly visibleAfterIso?: string
  readonly dismissedKeys?: ReadonlySet<string>
}

const PROVIDER_UPDATE_SUCCESS_VISIBLE_MS = 3_000

export function isProviderUpdateCandidate(
  provider: ProviderInstanceSnapshot
): provider is ProviderUpdateCandidate {
  return (
    provider.enabled &&
    provider.versionAdvisory?.status === "behind_latest" &&
    typeof provider.versionAdvisory.latestVersion === "string" &&
    provider.versionAdvisory.latestVersion.length > 0
  )
}

export function isProviderUpdateActive(
  provider: Pick<ProviderInstanceSnapshot, "updateState">
): boolean {
  return (
    provider.updateState?.status === "queued" ||
    provider.updateState?.status === "running"
  )
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): ProviderUpdateCandidate[] {
  return dedupeProvidersByDriver(providers.filter(isProviderUpdateCandidate))
}

export function hasOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): boolean {
  const advisory = candidate.versionAdvisory
  if (advisory.canUpdate !== true || advisory.updateCommand === null) {
    return false
  }

  const driver = normalizeProviderDriverKind(candidate.driver)
  const siblingUpdateCommands = new Set<string>()
  for (const provider of providers) {
    if (normalizeProviderDriverKind(provider.driver) !== driver) continue
    if (!isProviderUpdateCandidate(provider)) continue
    const siblingAdvisory = provider.versionAdvisory
    if (
      siblingAdvisory.canUpdate !== true ||
      siblingAdvisory.updateCommand === null
    ) {
      return false
    }
    siblingUpdateCommands.add(siblingAdvisory.updateCommand)
  }
  return siblingUpdateCommands.size === 1
}

export function canOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): boolean {
  return (
    !isProviderUpdateActive(candidate) &&
    hasOneClickUpdateProviderCandidate(candidate, providers)
  )
}

export function providerUpdateNotificationKey(
  providers: ReadonlyArray<ProviderUpdateCandidate>
): string | null {
  const parts = dedupeProvidersByDriver(providers)
    .map((provider) =>
      [
        normalizeProviderDriverKind(provider.driver),
        provider.versionAdvisory.latestVersion,
      ].join(":")
    )
    .sort()
  return parts.length > 0 ? parts.join("|") : null
}

export function isProviderUpdateNotificationDismissed(
  dismissalKey: string | null | undefined
): boolean {
  if (!dismissalKey) return false
  return readProviderUpdateDismissals().includes(dismissalKey)
}

export function dismissProviderUpdateNotification(
  dismissalKey: string | null | undefined
): void {
  const key = dismissalKey?.trim()
  if (!key) return
  const dismissals = readProviderUpdateDismissals()
  if (dismissals.includes(key)) return
  writeProviderUpdateDismissals([...dismissals, key])
}

export function getProviderUpdateInitialView(input: {
  readonly updateProviders: ReadonlyArray<ProviderUpdateCandidate>
  readonly oneClickProviders: ReadonlyArray<ProviderUpdateCandidate>
}): ProviderUpdateView {
  return {
    phase: "initial",
    tone: "warning",
    title: getProviderUpdateInitialTitle(input.updateProviders),
    description:
      input.oneClickProviders.length > 0
        ? "Install the update now or review provider settings."
        : `${formatProviderList(input.updateProviders)} can be updated from provider settings.`,
  }
}

export function getProviderUpdateRunningView(
  providerCount: number
): ProviderUpdateView {
  return {
    phase: "running",
    tone: "loading",
    title: providerCount === 1 ? "Updating provider" : "Updating providers",
    description: "Running provider update command.",
  }
}

function updateGroups(providers: ReadonlyArray<ProviderInstanceSnapshot>) {
  const groups = new Map<string, ProviderInstanceSnapshot[]>()
  for (const provider of providers) {
    const state = provider.updateState?.status ?? "idle"
    const members = groups.get(state) ?? []
    members.push(provider)
    groups.set(state, members)
  }
  return groups
}

export function getProviderUpdateProgressView(input: {
  readonly providers: ReadonlyArray<ProviderInstanceSnapshot>
  readonly providerCount: number
}): ProviderUpdateView {
  const members = dedupeProvidersByDriver(input.providers)
  const groups = updateGroups(members)
  const failures = groups.get("failed")
  if (failures) {
    return {
      phase: "failed", tone: "error",
      title: failures.length === 1 ? "Provider update failed" : "Provider updates failed",
      description: getFailedProviderUpdateDescription(failures),
    }
  }
  const unchanged = groups.get("unchanged")
  if (unchanged) {
    return {
      phase: "unchanged", tone: "warning",
      title: unchanged.length === 1 ? "Provider still needs an update" : "Providers still need updates",
      description: formatProviderList(unchanged) + (unchanged.length === 1 ? " still appears" : " still appear") + " outdated. Check provider settings for details.",
    }
  }
  const incomplete = members.length < input.providerCount || groups.has("running") || groups.has("queued") ||
    members.some(provider => provider.updateState?.status !== "succeeded" && isProviderUpdateCandidate(provider))
  if (incomplete) return getProviderUpdateRunningView(input.providerCount)
  return {
    phase: "succeeded", tone: "success",
    title: input.providerCount === 1 ? "Provider updated" : "Provider updates finished",
    description: getProviderUpdatedDescription(input.providerCount),
    dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
  }
}

export function getSingleProviderUpdateProgressView(
  provider: ProviderInstanceSnapshot
): ProviderUpdateView {
  const view = getProviderUpdateProgressView({
    providers: [provider],
    providerCount: 1,
  })

  switch (view.phase) {
    case "running":
      return {
        ...view,
        title: `Updating ${providerDriverLabel(provider.driver)}`,
      }
    case "failed":
      return {
        ...view,
        title: getProviderFailedUpdateTitle(provider),
      }
    case "unchanged":
      return {
        ...view,
        title: `${providerDriverLabel(provider.driver)} still needs an update`,
      }
    case "succeeded":
      return {
        ...view,
        title: getProviderUpdatedTitle(provider),
      }
    default:
      return view
  }
}

export function collectUpdatedProviderSnapshots(input: {
  readonly results: ReadonlyArray<
    PromiseSettledResult<{
      readonly providers: ReadonlyArray<ProviderInstanceSnapshot>
    }>
  >
  readonly providerInstanceIds: ReadonlySet<string>
}): ProviderInstanceSnapshot[] {
  const matched: ProviderInstanceSnapshot[] = []
  for (const result of input.results) {
    if (result.status !== "fulfilled") continue
    for (const provider of result.value.providers) {
      if (input.providerInstanceIds.has(provider.instanceId)) {
        matched.push(provider)
      }
    }
  }
  return dedupeProvidersByInstanceId(matched)
}

export function firstRejectedProviderUpdateMessage(
  results: ReadonlyArray<PromiseSettledResult<unknown>>
): string | null {
  const rejected = results.find((result) => result.status === "rejected")
  if (!rejected) return null
  return rejected.reason instanceof Error
    ? rejected.reason.message
    : "Provider update failed."
}

function terminalUpdatePill(
  phase: "failed" | "unchanged" | "succeeded",
  members: ProviderInstanceSnapshot[],
): ProviderUpdateSidebarPillView {
  const count = members.length
  const first = members[0]!
  const key = phase + ":" + terminalProviderKey(members)
  switch (phase) {
    case "failed":
      return {
        key, tone: "error", dismissible: true,
        title: count === 1 ? getProviderFailedUpdateTitle(first) : count + " provider updates failed",
        description: getFailedProviderUpdateDescription(members),
      }
    case "unchanged":
      return {
        key, tone: "warning", dismissible: true,
        title: count === 1 ? providerDriverLabel(first.driver) + " still needs an update" : count + " providers still need updates",
        description: formatProviderList(members) + (count === 1 ? " still appears" : " still appear") + " outdated. Review provider settings for details.",
      }
    case "succeeded":
      return {
        key, tone: "success", dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
        title: count === 1 ? getProviderUpdatedTitle(first) : count + " providers updated",
        description: getProviderUpdatedDescription(count),
      }
  }
}

export function getProviderUpdateSidebarPillView(
  providers: ReadonlyArray<ProviderInstanceSnapshot>,
  options?: ProviderUpdateSidebarPillOptions,
): ProviderUpdateSidebarPillView | null {
  const members = dedupeProvidersByDriver(providers)
  const active = members.filter(isProviderUpdateActive)
  if (active.length) {
    const states = active.map(provider => normalizeProviderDriverKind(provider.driver) + ":" + (provider.updateState?.status ?? "idle"))
    return {
      key: "loading:" + states.sort().join("|"), tone: "loading",
      title: "Updating " + (active.length === 1 ? providerDriverLabel(active[0]!.driver) : active.length + " providers"),
      description: formatProviderList(active) + (active.length === 1 ? " update in progress." : " updates are in progress."),
    }
  }

  const groups = updateGroups(members.filter(provider => isRecentTerminalProvider(provider, options?.visibleAfterIso)))
  const candidates = (["failed", "unchanged", "succeeded"] as const).flatMap(phase => {
    const group = groups.get(phase)
    if (!group) return []
    const view = terminalUpdatePill(phase, group)
    if (options?.dismissedKeys?.has(view.key)) return []
    return [{ view, finished: latestFinishedAtForProviders(group) ?? "" }]
  })
  candidates.sort((a, b) => b.finished.localeCompare(a.finished))
  return candidates[0]?.view ?? null
}

export function formatProviderList(
  providers: ReadonlyArray<Pick<ProviderInstanceSnapshot, "driver">>
): string {
  const names = providers.map((provider) =>
    providerDriverLabel(provider.driver)
  )
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

function dedupeProvidersByDriver<T extends ProviderInstanceSnapshot>(
  providers: ReadonlyArray<T>
): T[] {
  const byDriver = new Map<string, T>()
  for (const provider of providers) {
    const key = normalizeProviderDriverKind(provider.driver)
    const current = byDriver.get(key)
    byDriver.set(key, chooseRepresentativeProvider(current, provider))
  }
  return [...byDriver.values()]
}

function dedupeProvidersByInstanceId<T extends ProviderInstanceSnapshot>(
  providers: ReadonlyArray<T>
): T[] {
  const byInstance = new Map<string, T>()
  for (const provider of providers) {
    const current = byInstance.get(provider.instanceId)
    if (!current || provider.checkedAt.localeCompare(current.checkedAt) >= 0) {
      byInstance.set(provider.instanceId, provider)
    }
  }
  return [...byInstance.values()]
}

function chooseRepresentativeProvider<T extends ProviderInstanceSnapshot>(
  current: T | undefined,
  candidate: T
): T {
  if (!current) return candidate
  const driver = normalizeProviderDriverKind(candidate.driver)
  const defaultInstanceId = defaultInstanceIdForDriver(driver)
  if (candidate.instanceId === defaultInstanceId) return candidate
  if (current.instanceId === defaultInstanceId) return current
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0
    ? candidate
    : current
}

function getProviderUpdateInitialTitle(
  providers: ReadonlyArray<ProviderUpdateCandidate>
): string {
  if (providers.length === 1) {
    const provider = providers[0]!
    return `Update Available: ${providerDriverLabel(provider.driver)} ${formatVersion(
      provider.versionAdvisory.latestVersion
    )}`
  }
  return `Updates Available: ${providers.length} providers`
}

function getProviderUpdatedTitle(provider: Pick<ProviderInstanceSnapshot, "driver" | "version">): string {
  const text = providerDriverLabel(provider.driver) + " updated"
  return provider.version ? text + ": " + formatVersion(provider.version) : text
}

function getProviderUpdatedDescription(providerCount: number): string {
  return providerCount === 1
    ? "New sessions will use the updated provider."
    : "New sessions will use the updated providers."
}

function getProviderFailedUpdateTitle(
  provider: Pick<ProviderInstanceSnapshot, "driver" | "versionAdvisory">
): string {
  const providerName = providerDriverLabel(provider.driver)
  const attemptedVersion = provider.versionAdvisory?.latestVersion
  return attemptedVersion
    ? `${providerName} ${formatVersion(attemptedVersion)} update failed`
    : `${providerName} update failed`
}

function getFailedProviderUpdateDescription(
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): string {
  if (providers.length === 1) {
    const message = providers[0]?.updateState?.message
    if (message) return message
  }
  return `${formatProviderList(providers)} failed to update. Check provider settings for details.`
}

function getUpdateFinishedAt(
  provider: ProviderInstanceSnapshot
): string | null {
  return provider.updateState?.finishedAt ?? null
}

function isRecentTerminalProvider(
  provider: ProviderInstanceSnapshot,
  visibleAfterIso: string | undefined
): boolean {
  const status = provider.updateState?.status
  if (status !== "failed" && status !== "unchanged" && status !== "succeeded") {
    return false
  }
  if (visibleAfterIso === undefined) return true
  const finishedAt = getUpdateFinishedAt(provider)
  return finishedAt !== null && Date.parse(finishedAt) >= Date.parse(visibleAfterIso)
}

function latestFinishedAtForProviders(
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): string | null {
  return providers.reduce<string | null>((latest, provider) => {
    const finishedAt = getUpdateFinishedAt(provider)
    if (finishedAt === null) return latest
    return latest === null || finishedAt > latest ? finishedAt : latest
  }, null)
}

function terminalProviderKey(
  providers: ReadonlyArray<ProviderInstanceSnapshot>
): string {
  return providers
    .map(
      (provider) =>
        `${normalizeProviderDriverKind(provider.driver)}:${
          provider.updateState?.finishedAt ?? "pending"
        }:${provider.updateState?.message ?? ""}`
    )
    .sort()
    .join("|")
}



function providerDriverLabel(driver: string): string {
  const normalized = normalizeProviderDriverKind(driver)
  if (normalized === "codex") return "Codex"
  if (normalized === "claude") return "Claude"
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`
}

function readProviderUpdateDismissals(): string[] {
  try {
    if (typeof localStorage === "undefined") return []
    const raw = localStorage.getItem(PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return []
    }
    const keys = (parsed as { keys?: unknown }).keys
    return Array.isArray(keys)
      ? keys.filter((key): key is string => typeof key === "string")
      : []
  } catch {
    return []
  }
}

function writeProviderUpdateDismissals(keys: ReadonlyArray<string>): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(
      PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY,
      JSON.stringify({ keys })
    )
  } catch {
    // Best-effort UI state.
  }
}
