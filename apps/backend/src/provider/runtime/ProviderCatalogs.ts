import { HttpError } from "../../errors"
import type { ProviderAdapterShape, ProviderModel } from "./contracts"
import {
  filterRuntimeModelsByProjectPolicy,
  isRuntimeProviderAllowedByProjectPolicy,
  isRuntimeModelAllowedByProjectPolicy,
  type ProjectProviderPolicy,
  type RuntimeProviderPolicyTarget,
} from "./projectProviderPolicy"
import { listProjectProviders } from "../../services/workspace"

/**
 * Model catalogs and the workspace's provider/model policy, kept out of the
 * hub so the hub never has to know how a policy is read from disk. The hub
 * still owns admission (`assertAcceptingWork`, instance lookup); this class
 * only answers "which models, and is this one allowed here".
 */

export type ProjectProviderPolicyLoader = (
  cwd: string
) => Promise<ProjectProviderPolicy | null>

/** What the policy needs from an instance — a `ProviderRuntimeInstance` fits. */
export interface ProviderCatalogTarget extends RuntimeProviderPolicyTarget {
  readonly provider?: string | null
}

export class ProviderCatalogs {
  constructor(
    private readonly loader: ProjectProviderPolicyLoader = listProjectProviders
  ) {}

  async loadProjectPolicy(
    projectPath?: string | null
  ): Promise<ProjectProviderPolicy | null> {
    const workspace = projectPath?.trim()
    if (!workspace) return null
    // A malformed or unreadable policy must not silently widen provider
    // access. The loader already represents an absent policy as `null`.
    return this.loader(workspace)
  }

  /**
   * The adapter's live catalog, filtered by the workspace policy. Adapter
   * failures propagate — a caller listing models for a picker wants the
   * error, unlike the status snapshot which degrades to `[]`
   * (`readAdapterModels`).
   */
  async modelsForTarget(
    target: RuntimeProviderPolicyTarget,
    adapter: ProviderAdapterShape,
    cwd?: string | null
  ): Promise<ReadonlyArray<ProviderModel>> {
    const models = await adapter.availableModels()
    const policy = await this.loadProjectPolicy(cwd ?? null)
    return filterRuntimeModelsByProjectPolicy(target, models, policy)
  }

  async assertInstanceAllowed(input: {
    readonly instance: ProviderCatalogTarget
    readonly projectPath?: string | null
  }): Promise<ProjectProviderPolicy | null> {
    const policy = await this.loadProjectPolicy(input.projectPath)
    if (
      !policy ||
      (policy.enabledProviders.length === 0 &&
        policy.disabledProviders.length === 0)
    ) {
      return policy
    }
    if (isRuntimeProviderAllowedByProjectPolicy(input.instance, policy)) {
      return policy
    }

    const displayName =
      input.instance.displayName ??
      input.instance.provider ??
      input.instance.driver ??
      input.instance.instanceId
    throw new HttpError(403,
      `Provider '${displayName}' is disabled by this workspace's BetterC0de provider policy.`, "provider_policy_denied"
    )
  }

  assertModelAllowed(input: {
    readonly instance: ProviderCatalogTarget
    readonly model: string | null | undefined
    readonly policy: ProjectProviderPolicy | null
  }): void {
    const model = input.model?.trim()
    if (!model || !input.policy) return
    if (
      isRuntimeModelAllowedByProjectPolicy(
        input.instance,
        { slug: model, name: model },
        input.policy
      )
    ) {
      return
    }

    const displayName =
      input.instance.displayName ??
      input.instance.provider ??
      input.instance.driver ??
      input.instance.instanceId
    throw new HttpError(403,
      `Model '${model}' is disabled by this workspace's BetterC0de provider policy for provider '${displayName}'.`, "model_policy_denied"
    )
  }
}

/** Status-snapshot read: an adapter that cannot list models reports none. */
export async function readAdapterModels(
  adapter: ProviderAdapterShape,
  input: { readonly force?: boolean } = {}
): Promise<ReadonlyArray<ProviderModel>> {
  try {
    return await adapter.availableModels({ force: input.force })
  } catch {
    return []
  }
}

export function normalizeProviderModels(
  models: ReadonlyArray<ProviderModel>
): ReadonlyArray<ProviderModel> {
  return models.map((model) => ({
    ...model,
    isCustom: model.isCustom ?? false,
    capabilities: model.capabilities ?? null,
  }))
}
