import { describe, expect, it, vi } from "vitest"
import type { ProviderAdapterShape } from "./contracts"
import type {
  ProviderRuntimeInstance,
  ProviderRuntimeInstanceSnapshot,
} from "./ProviderHub"
import type { ProviderMaintenanceCommandResult } from "./ProviderMaintenance"
import {
  ProviderMaintenanceCoordinator,
  ProviderUpdateError,
  recordConfig,
  type MaintenanceHubPort,
} from "./ProviderMaintenanceCoordinator"

function stubAdapter(): ProviderAdapterShape {
  return {
    provider: "codex",
    displayName: "Codex",
    capabilities: {
      supportsStreaming: true,
      supportsTools: true,
      supportsApprovals: true,
      supportsResume: true,
      managesOwnLifecycle: true,
    },
    isConfigured: () => true,
    availableModels: async () => [],
    startSession: async () => {
      throw new Error("not used")
    },
    sendTurn: async () => {},
    interruptTurn: async () => {},
    respondToRequest: async () => {},
    stopSession: async () => {},
    hasSession: () => false,
    subscribe: () => () => {},
    stopAll: async () => {},
  }
}

function instance(
  overrides: Partial<ProviderRuntimeInstance> & { readonly instanceId: string }
): ProviderRuntimeInstance {
  return {
    driver: "codex",
    provider: "codex",
    displayName: "Codex",
    enabled: true,
    version: "1.0.0",
    adapter: stubAdapter(),
    ...overrides,
  }
}

function snapshot(
  instanceId: string,
  advisory: "current" | "behind_latest" | "unknown" = "current"
): ProviderRuntimeInstanceSnapshot {
  return {
    instanceId,
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    configured: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-05-13T00:00:00.000Z",
    availability: "available",
    environment: [],
    config: {},
    capabilities: stubAdapter().capabilities,
    models: [],
    providerCatalog: [],
    skills: [],
    agents: [],
    tools: [],
    slashCommands: [],
    versionAdvisory: {
      status: advisory,
      currentVersion: "1.0.0",
      latestVersion: advisory === "behind_latest" ? "2.0.0" : "1.0.0",
      updateCommand: null,
      canUpdate: advisory === "behind_latest",
      checkedAt: null,
      message: null,
    },
  }
}

function commandResult(
  overrides: Partial<ProviderMaintenanceCommandResult> = {}
): ProviderMaintenanceCommandResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** `listInstances` and `refreshAndDrain` are spies unless overridden. */
function fakePort(
  instances: ReadonlyArray<ProviderRuntimeInstance>,
  overrides: Partial<MaintenanceHubPort> = {}
): MaintenanceHubPort {
  const listInstances = vi.fn<MaintenanceHubPort["listInstances"]>(async () =>
    instances.map((candidate) => snapshot(candidate.instanceId))
  )
  const refreshAndDrain = vi.fn<MaintenanceHubPort["refreshAndDrain"]>(
    async () => {}
  )
  return {
    getInstance: (instanceId) =>
      instances.find((candidate) => candidate.instanceId === instanceId) ??
      null,
    isQuarantined: () => false,
    listInstances,
    refreshAndDrain,
    assertAcceptingWork: () => {},
    ...overrides,
  }
}

describe("ProviderMaintenanceCoordinator.updateInstance admission", () => {
  it("consults the hub's shutdown gate before anything else", async () => {
    const port = fakePort([instance({ instanceId: "codex" })], {
      assertAcceptingWork: (operation) => {
        throw new ProviderUpdateError(`Cannot ${operation}: shutting down.`, 503)
      },
      getInstance: () => {
        throw new Error("must not be reached")
      },
    })
    const coordinator = new ProviderMaintenanceCoordinator(port)
    await expect(coordinator.updateInstance("codex")).rejects.toMatchObject({
      name: "ProviderUpdateError",
      statusCode: 503,
      message: "Cannot update provider instance: shutting down.",
    })
  })

  it.each([
    {
      name: "unknown instance",
      instances: [],
      target: "missing",
      statusCode: 404,
      message: "Provider instance not found.",
    },
    {
      name: "disabled instance",
      instances: [instance({ instanceId: "codex", enabled: false })],
      target: "codex",
      statusCode: 409,
      message: "Provider instance is disabled.",
    },
    {
      name: "unavailable instance",
      instances: [instance({ instanceId: "codex", unavailableReason: "gone" })],
      target: "codex",
      statusCode: 409,
      message: "Provider instance is unavailable.",
    },
    {
      name: "provider without one-click updates",
      instances: [instance({ instanceId: "local", driver: "betterc0de" })],
      target: "local",
      statusCode: 409,
      message: "This provider does not support one-click updates.",
    },
  ])("rejects a $name with a typed error", async ({ instances, target, statusCode, message }) => {
    const runner = vi.fn(async () => commandResult())
    const coordinator = new ProviderMaintenanceCoordinator(fakePort(instances), {
      providerMaintenanceCommandRunner: runner,
    })
    const failure = await coordinator.updateInstance(target).catch((e) => e)
    expect(failure).toBeInstanceOf(ProviderUpdateError)
    expect(failure).toMatchObject({ statusCode, message })
    expect(runner).not.toHaveBeenCalled()
    expect(coordinator.updateStateFor(target)).toBeUndefined()
  })

  it("rejects a quarantined backend as temporarily unavailable", async () => {
    const codex = instance({ instanceId: "codex" })
    const port = fakePort([codex], {
      isQuarantined: (adapter) => adapter === codex.adapter,
    })
    const coordinator = new ProviderMaintenanceCoordinator(port)
    await expect(coordinator.updateInstance("codex")).rejects.toMatchObject({
      name: "ProviderUpdateError",
      statusCode: 503,
      message: "Provider instance is temporarily unavailable.",
    })
  })

  it("rejects a second update for a target whose update is still running", async () => {
    const gate = deferred<ProviderMaintenanceCommandResult>()
    const runner = vi.fn(() => gate.promise)
    const port = fakePort([instance({ instanceId: "codex" })])
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: runner,
    })

    const first = coordinator.updateInstance("codex")
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    await expect(coordinator.updateInstance("codex")).rejects.toThrow(
      "An update is already running for this provider."
    )
    expect(coordinator.updateStateFor("codex")?.status).toBe("running")

    gate.resolve(commandResult())
    await first
    // The target is released once the update settles.
    await coordinator.updateInstance("codex")
    expect(runner).toHaveBeenCalledTimes(2)
  })
})

describe("ProviderMaintenanceCoordinator.updateInstance outcomes", () => {
  it("runs the update command with the instance environment and reports success", async () => {
    const runner = vi.fn(async () => commandResult({ stdout: "updated" }))
    const port = fakePort([
      instance({
        instanceId: "codex",
        environment: [
          { name: "CODEX_HOME", value: "/home/codex" },
          { name: "OPENAI_API_KEY", value: "instance-secret", sensitive: true },
        ],
      }),
    ])
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: runner,
    })

    const result = await coordinator.updateInstance("codex", { cwd: "/repo" })

    expect(runner).toHaveBeenCalledTimes(1)
    const [input] = runner.mock.calls[0] as unknown as [
      { executable: string; args: ReadonlyArray<string>; env: NodeJS.ProcessEnv },
    ]
    expect(input.executable).toBeTruthy()
    expect(input.env.CODEX_HOME).toBe("/home/codex")
    expect(input.env.OPENAI_API_KEY).toBeUndefined()
    expect(port.refreshAndDrain).toHaveBeenCalledWith("codex")
    // The listing after the refresh and the final result listing both carry
    // the caller's cwd so policy filtering matches what the caller sees.
    expect(port.listInstances).toHaveBeenCalledWith({ cwd: "/repo" })
    expect(result.instance?.instanceId).toBe("codex")
    expect(result.providers.map((provider) => provider.instanceId)).toEqual([
      "codex",
    ])
    expect(coordinator.updateStateFor("codex")).toMatchObject({
      status: "succeeded",
      message: "Provider updated.",
      output: null,
    })
    expect(coordinator.updateStateFor("codex")?.finishedAt).not.toBeNull()
  })

  it("reports 'unchanged' when the refreshed instance is still behind", async () => {
    const port = fakePort([instance({ instanceId: "codex" })], {
      listInstances: async () => [snapshot("codex", "behind_latest")],
    })
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: async () => commandResult(),
    })
    await coordinator.updateInstance("codex")
    expect(coordinator.updateStateFor("codex")).toMatchObject({
      status: "unchanged",
      message:
        "Update command completed, but BetterC0de still detects an outdated provider version.",
    })
  })

  it("reports 'unchanged' when the instance disappears from the listing", async () => {
    const port = fakePort([instance({ instanceId: "codex" })], {
      listInstances: async () => [],
    })
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: async () => commandResult(),
    })
    const result = await coordinator.updateInstance("codex")
    expect(result.instance).toBeNull()
    expect(coordinator.updateStateFor("codex")).toMatchObject({
      status: "unchanged",
      message:
        "Update command completed, but BetterC0de could not verify the provider version.",
    })
  })

  it.each([
    {
      name: "non-zero exit",
      result: commandResult({ exitCode: 1, stderr: "nope" }),
      message: "Update command exited with code 1.",
    },
    {
      name: "timeout",
      result: commandResult({ exitCode: null, timedOut: true }),
      message: "Update timed out.",
    },
  ])("marks a $name as failed without refreshing the instance", async ({ result, message }) => {
    const port = fakePort([instance({ instanceId: "codex" })])
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: async () => result,
    })
    const outcome = await coordinator.updateInstance("codex")
    expect(outcome.instance?.instanceId).toBe("codex")
    expect(port.refreshAndDrain).not.toHaveBeenCalled()
    expect(coordinator.updateStateFor("codex")).toMatchObject({
      status: "failed",
      message,
      // Command output never reaches the snapshot; it may contain secrets.
      output: null,
    })
  })

  it("masks a runner or refresh exception as a failed state and still returns the listing", async () => {
    const port = fakePort([instance({ instanceId: "codex" })])
    const throwingRunner = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: async () => {
        throw new Error("spawn EACCES: /secret/path")
      },
    })
    const result = await throwingRunner.updateInstance("codex")
    expect(result.providers).toHaveLength(1)
    expect(throwingRunner.updateStateFor("codex")).toMatchObject({
      status: "failed",
      message: "Provider update failed.",
      output: null,
    })

    const failingRefresh = new ProviderMaintenanceCoordinator(
      fakePort([instance({ instanceId: "codex" })], {
        refreshAndDrain: async () => {
          throw new Error("replacement deferred")
        },
      }),
      { providerMaintenanceCommandRunner: async () => commandResult() }
    )
    await expect(failingRefresh.updateInstance("codex")).resolves.toMatchObject(
      { instance: { instanceId: "codex" } }
    )
    expect(failingRefresh.updateStateFor("codex")).toMatchObject({
      status: "failed",
      message: "Provider update failed.",
    })
  })
})

describe("ProviderMaintenanceCoordinator update lock", () => {
  it("serialises updates that share a lock key and exposes the tails for shutdown", async () => {
    const gates: Array<ReturnType<typeof deferred<ProviderMaintenanceCommandResult>>> = []
    const runner = vi.fn(() => {
      const gate = deferred<ProviderMaintenanceCommandResult>()
      gates.push(gate)
      return gate.promise
    })
    // Two instances of the same driver resolve to the same package-manager
    // lock key, so their updates must not run concurrently.
    const port = fakePort([
      instance({ instanceId: "codex" }),
      instance({ instanceId: "codex_work" }),
    ])
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: runner,
    })
    const first = coordinator.capabilitiesFor(port.getInstance("codex")!)
    const second = coordinator.capabilitiesFor(port.getInstance("codex_work")!)
    expect(first.update?.lockKey).toBe(second.update?.lockKey)
    expect(coordinator.pendingLockTails()).toEqual([])

    const firstUpdate = coordinator.updateInstance("codex")
    const secondUpdate = coordinator.updateInstance("codex_work")
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    expect(coordinator.updateStateFor("codex")?.status).toBe("running")
    expect(coordinator.updateStateFor("codex_work")).toMatchObject({
      status: "queued",
      message: "Waiting for another provider update to finish.",
    })
    expect(coordinator.pendingLockTails()).toHaveLength(1)

    gates[0]!.resolve(commandResult())
    await firstUpdate
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    expect(coordinator.updateStateFor("codex_work")?.status).toBe("running")

    gates[1]!.resolve(commandResult())
    await secondUpdate
    await vi.waitFor(() => expect(coordinator.pendingLockTails()).toEqual([]))
    expect(coordinator.updateStateFor("codex")?.status).toBe("succeeded")
    expect(coordinator.updateStateFor("codex_work")?.status).toBe("succeeded")
  })

  it("lets a queued update run after the one ahead of it fails", async () => {
    const results = [
      deferred<ProviderMaintenanceCommandResult>(),
      deferred<ProviderMaintenanceCommandResult>(),
    ]
    let call = 0
    const runner = vi.fn(() => results[call++]!.promise)
    const port = fakePort([
      instance({ instanceId: "codex" }),
      instance({ instanceId: "codex_work" }),
    ])
    const coordinator = new ProviderMaintenanceCoordinator(port, {
      providerMaintenanceCommandRunner: runner,
    })

    const firstUpdate = coordinator.updateInstance("codex")
    const secondUpdate = coordinator.updateInstance("codex_work")
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    results[0]!.reject(new Error("first exploded"))
    await firstUpdate
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    results[1]!.resolve(commandResult())
    await secondUpdate

    expect(coordinator.updateStateFor("codex")?.status).toBe("failed")
    expect(coordinator.updateStateFor("codex_work")?.status).toBe("succeeded")
  })
})

describe("ProviderMaintenanceCoordinator capabilities", () => {
  it("resolves capabilities from the driver, config binary path and environment", () => {
    const coordinator = new ProviderMaintenanceCoordinator(fakePort([]))
    const codex = coordinator.capabilitiesFor(
      instance({ instanceId: "codex", config: { binaryPath: "/opt/homebrew/bin/codex" } })
    )
    expect(codex.provider).toBe("codex")
    expect(codex.update?.command).toBe("brew upgrade codex")
    const manual = coordinator.capabilitiesFor(
      instance({ instanceId: "local", driver: "betterc0de" })
    )
    expect(manual.update).toBeNull()
  })

  it("delegates the latest-version lookup to the injected resolver", async () => {
    const resolver = vi.fn(async () => "9.9.9")
    const coordinator = new ProviderMaintenanceCoordinator(fakePort([]), {
      latestProviderVersionResolver: resolver,
    })
    const capabilities = coordinator.capabilitiesFor(instance({ instanceId: "codex" }))
    await expect(coordinator.latestVersionFor(capabilities)).resolves.toBe("9.9.9")
    expect(resolver).toHaveBeenCalledWith(capabilities)
  })

  it("reads only object configs as records", () => {
    expect(recordConfig({ binaryPath: "codex" })).toEqual({ binaryPath: "codex" })
    expect(recordConfig(null)).toEqual({})
    expect(recordConfig("codex")).toEqual({})
    expect(recordConfig(["codex"])).toEqual({})
  })
})

describe("ProviderUpdateError", () => {
  it("is an HttpError defaulting to 409", () => {
    const conflict = new ProviderUpdateError("busy")
    expect(conflict).toMatchObject({
      name: "ProviderUpdateError",
      statusCode: 409,
      message: "busy",
    })
    expect(new ProviderUpdateError("gone", 404).statusCode).toBe(404)
  })
})
