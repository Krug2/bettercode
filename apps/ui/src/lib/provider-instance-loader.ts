import type { ProviderInstanceSnapshot } from "@betterc0de/schema"
import {
  listProviderInstanceModels,
  listProviderInstances,
} from "@/services/backend/providersApi"

/** Owns requests for one workspace; a late response cannot replace newer metadata. */
export function createProviderInstanceLoader(
  cwd: string | null | undefined,
  publish: (instances: ProviderInstanceSnapshot[]) => void
) {
  let revision = 0
  let disposed = false
  const refresh = async () => {
    if (disposed) return
    const request = ++revision
    try {
      const snapshots = await listProviderInstances(cwd)
      if (disposed || request !== revision) return
      const withModels = await Promise.all(
        snapshots.map(async (instance) => {
          if (
            !instance.enabled ||
            !instance.configured ||
            instance.models !== undefined
          )
            return instance
          try {
            const models = await listProviderInstanceModels(
              instance.instanceId,
              cwd
            )
            return {
              ...instance,
              models: models.map((model) => ({
                ...model,
                isCustom: model.isCustom ?? false,
                capabilities: model.capabilities ?? null,
              })),
            }
          } catch {
            return instance
          }
        })
      )
      if (!disposed && request === revision) publish(withModels)
    } catch {
      // Preserve the last-known catalog during a backend restart.
    }
  }
  return {
    refresh,
    dispose: () => {
      disposed = true
    },
  }
}
