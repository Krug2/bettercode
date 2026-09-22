import { invokeContract } from "./contracts"
import type { OrchestratorContextGrant } from "@betterc0de/schema"

export const startOrchestrator = (projectPath: string) =>
  invokeContract("orchestratorStart", { body: { projectPath } })
export const getOrchestratorStatus = (threadId: string, signal?: AbortSignal) =>
  invokeContract("orchestratorStatus", {
    body: { threadId },
    signal,
    silentStatuses: [403],
  })
export const stopOrchestrator = (threadId: string) =>
  invokeContract("orchestratorStop", { body: { threadId } })
export const resumeOrchestrator = (threadId: string) =>
  invokeContract("orchestratorResume", { body: { threadId } })
export const grantOrchestratorContext = (body: OrchestratorContextGrant) =>
  invokeContract("orchestratorContextGrant", { body })
export const readOrchestratorContext = (
  threadId: string,
  contextId: string,
  signal?: AbortSignal
) =>
  invokeContract("orchestratorContextRead", {
    body: { threadId, contextId },
    signal,
  })
export const removeOrchestratorContext = (
  threadId: string,
  contextId: string
) =>
  invokeContract("orchestratorContextRemove", { body: { threadId, contextId } })
