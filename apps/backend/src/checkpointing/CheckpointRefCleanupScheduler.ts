import { logger } from "../observability/logger"
import { deleteCheckpointRefs } from "../services/git"
import {
  CheckpointRefCleanupStore,
  type CheckpointRefCleanupEntry,
} from "./CheckpointRefCleanupStore"
import type { CheckpointRefOperationGate } from "./CheckpointRefOperationGate"

const DEFAULT_INTERVAL_MS = 5 * 60_000

export interface CheckpointRefCleanupSchedulerOptions {
  readonly shouldDefer?: (entry: CheckpointRefCleanupEntry) => boolean
  readonly refOperationGate?: CheckpointRefOperationGate
}

export class CheckpointRefCleanupScheduler {
  private timer: NodeJS.Timeout | null = null
  private activeRun: Promise<number> | null = null
  private stopped = false

  constructor(
    private readonly store: CheckpointRefCleanupStore,
    private readonly resolveCwd: (entry: CheckpointRefCleanupEntry) => string,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly options: CheckpointRefCleanupSchedulerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => {
      void this.runNow().catch((error) => {
        logger.error(
          { err: error },
          "durable checkpoint ref cleanup pass failed"
        )
      })
    }, Math.max(10_000, this.intervalMs))
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.activeRun
  }

  runNow(): Promise<number> {
    return this.run(false)
  }

  recoverOrphansAtStartup(): Promise<number> {
    return this.run(true)
  }

  private run(includeFresh: boolean): Promise<number> {
    if (this.stopped) return Promise.resolve(0)
    if (this.activeRun) return this.activeRun
    const run = this.execute(includeFresh).finally(() => {
      if (this.activeRun === run) this.activeRun = null
    })
    this.activeRun = run
    return run
  }

  private async execute(includeFresh: boolean): Promise<number> {
    const createdBefore = new Date().toISOString()
    let after:
      | {
          readonly createdAt: string
          readonly cwd: string
          readonly checkpointRef: string
        }
      | undefined
    let cleaned = 0
    while (!this.stopped) {
      const entries = this.store.listBatch({
        includeFresh,
        createdBefore,
        ...(after ? { after } : {}),
      })
      if (entries.length === 0) break

      for (const entry of entries) {
        if (this.stopped) break
        const runEntry = async () => {
          const current = this.store.get(entry.cwd, entry.checkpointRef)
          if (!current || current.intentId !== entry.intentId) return false
          if (this.options.shouldDefer?.(current)) return false
          if (this.store.isReferenced(current.checkpointRef)) {
            this.store.completeIntent(current)
            return false
          }
          // attempts=0 denotes a ref that may still be in the live capture
          // window. Startup recovery can process it because no reactor work
          // has been admitted in this process yet.
          if (!includeFresh && current.attempts === 0) return false
          const cwd = this.resolveCwd(current)
          try {
            await deleteCheckpointRefs({
              cwd,
              checkpointRefs: [current.checkpointRef],
            })
            if (this.store.completeIntent(current)) cleaned += 1
            return true
          } catch (error) {
            this.store.recordIntentFailure(current, error)
            logger.warn(
              {
                err: error,
                threadId: current.threadId,
                checkpointRef: current.checkpointRef,
                cwd,
              },
              "durable checkpoint ref cleanup retry failed"
            )
            return false
          }
        }
        if (this.options.refOperationGate) {
          await this.options.refOperationGate.withRef(
            entry.cwd,
            entry.checkpointRef,
            runEntry
          )
        } else {
          await runEntry()
        }
      }
      const last = entries.at(-1)!
      after = {
        createdAt: last.createdAt,
        cwd: last.cwd,
        checkpointRef: last.checkpointRef,
      }
      if (entries.length < 128) break
    }
    return cleaned
  }
}
