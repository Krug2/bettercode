export const WS_METHODS = {
  serverGetConfig: "server.getConfig",
  providersListInstances: "providers.listInstances",
  providersModelsForInstance: "providers.modelsForInstance",
  threadsListActivities: "threads.listActivities",
} as const

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS]
