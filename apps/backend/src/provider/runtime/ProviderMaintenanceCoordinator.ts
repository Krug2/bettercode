import { HttpError } from "../../http/errors"
import { sanitizedChildEnvironment } from "../../security/childEnvironment"
import type { ProviderAdapterShape } from "./contracts"
import type {
  ProviderRuntimeInstance,
  ProviderRuntimeInstanceSnapshot,
} from "./ProviderHub"
import {
  isProviderMaintenanceEnvironmentKey,
  resolveLatestProviderVersion,
  resolveProviderMaintenanceCapabilities,
  runProviderMaintenanceCommand,
  type ProviderMaintenanceCapabilities,
  type ProviderMaintenanceCommandResult,
  type ProviderMaintenanceCommandRunnerInput,
} from "./ProviderMaintenance"

/**
 * One-click provider updates: the per-instance update state the status
 * snapshot reports, the "one update at a time per target" guard, and the
 * per-lock-key queue that serialises updates sharing a package manager.
 * Everything that touches the registry or shutdown state goes through the
 * `MaintenanceHubPort` so this class can be driven by a fake in tests.
 */

export class ProviderUpdateError extends HttpError {
  constructor(message: string, statusCode = 409) {
    super(statusCode, message)
    this.name = "ProviderUpdateError"
  }
}

export type ProviderUpdateState = NonNullable<
  ProviderRuntimeInstanceSnapshot["updateState"]
>

export interface ProviderUpdateResult {
  readonly instance: ProviderRuntimeInstanceSnapshot | null
  readonly providers: ReadonlyArray<ProviderRuntimeInstanceSnapshot>
}

export interface MaintenanceHubPort {
  getInstance(instanceId: string): ProviderRuntimeInstance | null
  isQuarantined(adapter: ProviderAdapterShape): boolean
  listInstances(input: {
    readonly cwd?: string | null
  }): Promise<ProviderRuntimeInstanceSnapshot[]>
  /** Re-resolve the instance from its source of truth and apply it. */
  refreshAndDrain(instanceId: string): Promise<void>
  assertAcceptingWork(operation: string): void
}

export interface ProviderMaintenanceCoordinatorOptions {
  readonly latestProviderVersionResolver?: (
    capabilities: ProviderMaintenanceCapabilities
  ) => Promise<string | null>
  readonly providerMaintenanceCommandRunner?: (
    input: ProviderMaintenanceCommandRunnerInput
  ) => Promise<ProviderMaintenanceCommandResult>
}

export class ProviderMaintenanceCoordinator {
  private readonly latestProviderVersionResolver: (
    capabilities: ProviderMaintenanceCapabilities
  ) => Promise<string | null>
  private readonly providerMaintenanceCommandRunner: (
    input: ProviderMaintenanceCommandRunnerInput
  ) => Promise<ProviderMaintenanceCommandResult>
  private readonly updateStates = new Map<string, ProviderUpdateState>()
  private readonly runningUpdateTargets = new Set<string>()
  private readonly updateLockTails = new Map<string, Promise<void>>()

  constructor(
    private readonly port: MaintenanceHubPort,
    options: ProviderMaintenanceCoordinatorOptions = {}
  ) {
    this.latestProviderVersionResolver =
      options.latestProviderVersionResolver ?? resolveLatestProviderVersion
    this.providerMaintenanceCommandRunner =
      options.providerMaintenanceCommandRunner ?? runProviderMaintenanceCommand
  }

  async updateInstance(
    instanceId: string,
    input: { readonly cwd?: string | null } = {}
  ): Promise<ProviderUpdateResult> {
    this.port.assertAcceptingWork("update provider instance")
    const instance = this.port.getInstance(instanceId)
    if (!instance) {
      throw new ProviderUpdateError("Provider instance not found.", 404)
    }
    if (!instance.enabled) {
      throw new ProviderUpdateError("Provider instance is disabled.")
    }
    if (instance.unavailableReason) {
      throw new ProviderUpdateError("Provider instance is unavailable.")
    }
    if (this.port.isQuarantined(instance.adapter)) {
      throw new ProviderUpdateError(
        "Provider instance is temporarily unavailable.",
        503
      )
    }

    const capabilities = this.capabilitiesFor(instance)
    const update = capabilities.update
    if (!update) {
      throw new ProviderUpdateError(
        "This provider does not support one-click updates."
      )
    }

    const targetKey = `instance:${instance.instanceId}`
    if (this.runningUpdateTargets.has(targetKey)) {
      throw new ProviderUpdateError(
        "An update is already running for this provider."
      )
    }
    this.runningUpdateTargets.add(targetKey)

    try {
      return await this.withUpdateLock({
        lockKey: update.lockKey,
        onQueued: () =>
          this.setUpdateState(instance.instanceId, {
            status: "queued",
            startedAt: null,
            finishedAt: null,
            message: "Waiting for another provider update to finish.",
            output: null,
          }),
        run: async () => {
          const startedAt = new Date().toISOString()
          this.setUpdateState(instance.instanceId, {
            status: "running",
            startedAt,
            finishedAt: null,
            message: "Updating provider.",
            output: null,
          })

          try {
            const result = await this.providerMaintenanceCommandRunner({
              executable: update.executable,
              args: update.args,
              env: providerEnvironmentToProcessEnv(instance.environment ?? []),
            })
            const finishedAt = new Date().toISOString()

            if (result.timedOut || result.exitCode !== 0) {
              this.setUpdateState(instance.instanceId, {
                status: "failed",
                startedAt,
                finishedAt,
                message: providerUpdateFailureMessage(result),
                output: null,
              })
              return await this.listUpdatedInstances(
                instance.instanceId,
                input.cwd
              )
            }

            await this.port.refreshAndDrain(instance.instanceId)
            const providers = await this.port.listInstances({ cwd: input.cwd })
            const refreshed = providers.find(
              (provider) => provider.instanceId === instance.instanceId
            )
            const stillOutdated =
              !refreshed ||
              refreshed.versionAdvisory?.status === "behind_latest"
            this.setUpdateState(instance.instanceId, {
              status: stillOutdated ? "unchanged" : "succeeded",
              startedAt,
              finishedAt,
              message: !refreshed
                ? "Update command completed, but BetterC0de could not verify the provider version."
                : stillOutdated
                  ? "Update command completed, but BetterC0de still detects an outdated provider version."
                  : "Provider updated.",
              output: null,
            })
            return await this.listUpdatedInstances(
              instance.instanceId,
              input.cwd
            )
          } catch {
            this.setUpdateState(instance.instanceId, {
              status: "failed",
              startedAt,
              finishedAt: new Date().toISOString(),
              message: "Provider update failed.",
              output: null,
            })
            return await this.listUpdatedInstances(
              instance.instanceId,
              input.cwd
            )
          }
        },
      })
    } finally {
      this.runningUpdateTargets.delete(targetKey)
    }
  }

  capabilitiesFor(
    instance: ProviderRuntimeInstance
  ): ProviderMaintenanceCapabilities {
    const config = recordConfig(instance.config)
    return resolveProviderMaintenanceCapabilities({
      driver: instance.driver,
      binaryPath: readConfigString(config, "binaryPath") ?? instance.driver,
      env: providerEnvironmentToProcessEnv(instance.environment ?? []),
    })
  }

  latestVersionFor(
    capabilities: ProviderMaintenanceCapabilities
  ): Promise<string | null> {
    return this.latestProviderVersionResolver(capabilities)
  }

  updateStateFor(instanceId: string): ProviderUpdateState | undefined {
    return this.updateStates.get(instanceId)
  }

  /** Queued or running updates; shutdown drains these before stopping adapters. */
  pendingLockTails(): ReadonlyArray<Promise<void>> {
    return Array.from(this.updateLockTails.values())
  }

  private setUpdateState(instanceId: string, state: ProviderUpdateState): void {
    this.updateStates.set(instanceId, state)
  }

  private async listUpdatedInstances(
    instanceId: string,
    cwd: string | null | undefined
  ): Promise<ProviderUpdateResult> {
    const providers = await this.port.listInstances({ cwd })
    return {
      providers,
      instance:
        providers.find((provider) => provider.instanceId === instanceId) ??
        null,
    }
  }

  private async withUpdateLock<T>(input: {
    readonly lockKey: string
    readonly onQueued: () => void
    readonly run: () => Promise<T>
  }): Promise<T> {
    const previousTail = this.updateLockTails.get(input.lockKey)
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const nextTail = (previousTail ?? Promise.resolve())
      .catch(() => {})
      .then(() => current)
    this.updateLockTails.set(input.lockKey, nextTail)

    try {
      input.onQueued()
      await previousTail?.catch(() => {})
      return await input.run()
    } finally {
      releaseCurrent()
      void nextTail.finally(() => {
        if (this.updateLockTails.get(input.lockKey) === nextTail) {
          this.updateLockTails.delete(input.lockKey)
        }
      })
    }
  }
}

export function recordConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {}
  return config as Record<string, unknown>
}

function readConfigString(
  config: Record<string, unknown>,
  key: string
): string | null {
  const value = config[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function providerEnvironmentToProcessEnv(
  environment: NonNullable<ProviderRuntimeInstance["environment"]>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = sanitizedChildEnvironment()
  for (const item of environment) {
    if (
      !isProviderMaintenanceEnvironmentKey(item.name, item.sensitive === true)
    ) {
      continue
    }
    env[item.name] = item.value
  }
  return env
}

function providerUpdateFailureMessage(
  result: ProviderMaintenanceCommandResult
): string {
  if (result.timedOut) return "Update timed out."
  if (typeof result.exitCode === "number" && result.exitCode !== 0) {
    return `Update command exited with code ${result.exitCode}.`
  }
  return "Update command failed."
}
