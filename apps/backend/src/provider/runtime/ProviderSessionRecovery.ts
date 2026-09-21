import type { ProviderKind, ThreadId } from "./contracts"
import {
  isProviderSessionContinuationCompatible,
  type ProviderSessionBinding,
  type ProviderSessionBindingStore,
} from "./ProviderSessionBindingStore"

/**
 * Pure selection over persisted session bindings: which binding a thread can
 * resume on, and which foreign-provider binding would conflict with a new
 * session. The hub applies the answer; it does not compute it.
 */

export function selectRecoveryBinding(input: {
  readonly bindings: ProviderSessionBindingStore
  readonly thread: ThreadId
  readonly providerKind: ProviderKind
  readonly providerInstanceId: string
  readonly continuationKey: string | null
  readonly directBinding: ProviderSessionBinding | null
}): ProviderSessionBinding | null {
  const listBindings = (
    input.bindings as ProviderSessionBindingStore & {
      list?: () => ProviderSessionBinding[]
    }
  ).list
  const allBindings = listBindings
    ? listBindings.call(input.bindings)
    : input.directBinding
      ? [input.directBinding]
      : []
  const getThreadGeneration = (
    input.bindings as ProviderSessionBindingStore & {
      getThreadGeneration?: (threadId: string) => number
    }
  ).getThreadGeneration
  const currentGeneration = getThreadGeneration
    ? getThreadGeneration.call(input.bindings, input.thread)
    : Math.max(
        0,
        ...allBindings
          .filter((binding) => binding.threadId === input.thread)
          .map((binding) => binding.generation ?? 0)
      )
  if (
    isResumableBinding(input.directBinding) &&
    isProviderSessionContinuationCompatible(input.directBinding, input) &&
    (input.directBinding.generation ?? 0) === currentGeneration
  ) {
    return input.directBinding
  }
  const candidates = allBindings
    .filter(
      (binding) =>
        binding.threadId === input.thread &&
        binding.providerKind === input.providerKind &&
        binding.providerInstanceId !== input.providerInstanceId &&
        isProviderSessionContinuationCompatible(binding, input) &&
        (binding.generation ?? 0) === currentGeneration &&
        isResumableBinding(binding)
    )
  return candidates[candidates.length - 1] ?? null
}

export function findConflictingProviderBinding(input: {
  readonly bindings?: ProviderSessionBindingStore
  readonly threadId: string
  readonly providerKind: ProviderKind
}): ProviderSessionBinding | null {
  const bindings =
    input.bindings && typeof input.bindings.list === "function"
      ? input.bindings.list()
      : []
  const getThreadGeneration = (
    input.bindings as
      | (ProviderSessionBindingStore & {
          getThreadGeneration?: (threadId: string) => number
        })
      | undefined
  )?.getThreadGeneration
  const currentGeneration = getThreadGeneration
    ? getThreadGeneration.call(input.bindings, input.threadId)
    : Math.max(
        0,
        ...bindings
          .filter((binding) => binding.threadId === input.threadId)
          .map((binding) => binding.generation ?? 0)
      )
  return (
    bindings.find(
      (binding) =>
        binding.threadId === input.threadId &&
        binding.providerKind !== input.providerKind &&
        (binding.generation ?? 0) === currentGeneration &&
        isCurrentProviderBinding(binding)
    ) ?? null
  )
}

function isCurrentProviderBinding(binding: ProviderSessionBinding): boolean {
  if (
    binding.providerThreadId !== null ||
    binding.resumeCursor !== null ||
    binding.activeTurnId !== null
  ) {
    return true
  }
  return (
    binding.status === "starting" ||
    binding.status === "ready" ||
    binding.status === "running" ||
    binding.status === "closing"
  )
}

function isResumableBinding(
  binding: ProviderSessionBinding | null
): binding is ProviderSessionBinding {
  return (
    !!binding && (binding.resumeCursor != null || !!binding.providerThreadId)
  )
}
