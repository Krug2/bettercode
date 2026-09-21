/** One provider event with the fields every family reads off it. */
export interface ActivityContext {
  readonly threadId: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly providerKind: string | undefined
  readonly providerInstanceId: string | undefined
}
