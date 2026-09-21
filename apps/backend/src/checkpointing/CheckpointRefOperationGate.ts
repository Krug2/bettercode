/**
 * Serializes creation and cleanup of one deterministic Git checkpoint ref.
 * The ref itself is the identity: linked worktrees use different cwd values
 * while mutating the same repository ref namespace. Different refs remain
 * fully concurrent, including identically named repositories.
 */
export class CheckpointRefOperationGate {
  private readonly tails = new Map<string, Promise<void>>()

  async withRef<T>(
    cwd: string,
    checkpointRef: string,
    operation: () => Promise<T> | T
  ): Promise<T> {
    // Keep cwd in the API because callers still need it for the operation,
    // but deliberately do not include it in the mutex identity.
    void cwd
    const key = checkpointRef
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => owned)
    this.tails.set(key, tail)

    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
