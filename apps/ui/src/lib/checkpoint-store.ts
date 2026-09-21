import { create } from "zustand"
import {
  gitCaptureCheckpoint,
  gitDiffCheckpoints,
  gitStatus,
  isGitRepo,
  readFile,
  revertThreadCheckpoint,
  writeFile,
} from "@/services/backend"
import type { ToolCall } from "@/lib/chat-store"
import {
  checkpointRefForThreadTurn,
  parseTurnDiffFilesFromUnifiedDiff,
  type TurnDiffFileSummary,
} from "@betterc0de/schema/checkpointing"
import { createLogger } from "@/lib/logger"

const log = createLogger("checkpoint-store")

export interface Checkpoint {
  id: string
  threadId: string
  messageId: string
  label: string
  timestamp: string
  files: Record<string, string>
  gitBranch: string
  gitCommitHash?: string
  projectPath?: string
  checkpointRef?: string
  baseCheckpointRef?: string
  turnId?: string | null
  turnNumber?: number
  diff?: string
  diffFiles?: TurnDiffFileSummary[]
}

interface PendingTurnCheckpoint {
  threadId: string
  turnId: string | null
  projectPath: string
  turnNumber: number
  baseCheckpointRef: string
  checkpointRef: string
  startedAt: string
}

interface CheckpointState {
  checkpoints: Checkpoint[]
  pendingTurnCheckpoints: Record<string, PendingTurnCheckpoint>
  activeCheckpointId: string | null
  isRestoring: boolean

  createCheckpoint: (
    threadId: string,
    messageId: string,
    label: string,
    files: Record<string, string>,
    projectPath?: string | null
  ) => string
  recordGitCheckpoint: (input: {
    threadId: string
    messageId: string
    projectPath: string
    checkpointRef: string
    baseCheckpointRef?: string
    turnId?: string | null
    turnNumber?: number
    label?: string
    diff?: string
    diffFiles?: TurnDiffFileSummary[]
  }) => string | null
  restoreCheckpoint: (checkpointId: string) => Promise<void>
  deleteCheckpoint: (id: string) => void
  deleteCheckpointsAfter: (
    threadId: string,
    boundary: {
      messageIds?: readonly string[]
      turnNumber?: number
      preserveRefs?: boolean
    }
  ) => void
  getCheckpointsForThread: (threadId: string) => Checkpoint[]
  clearCheckpointsForThread: (threadId: string) => void
  captureTurnCheckpointStart: (input: {
    threadId: string
    turnId?: string | null
    projectPath?: string | null
  }) => Promise<PendingTurnCheckpoint | null>
  captureTurnCheckpointComplete: (input: {
    threadId: string
    messageId: string
    turnId?: string | null
    projectPath?: string | null
    label?: string
  }) => Promise<string | null>
  discardTurnCheckpoint: (threadId: string, turnId?: string | null) => void
}

function generateId() {
  return crypto.randomUUID()
}

function splitPath(filePath: string): { cwd: string; relativePath: string } {
  const normalized = filePath.replace(/\\/g, "/")
  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash <= 0) return { cwd: ".", relativePath: normalized }
  return {
    cwd: normalized.slice(0, lastSlash),
    relativePath: normalized.slice(lastSlash + 1),
  }
}

async function getCurrentBranch(cwd?: string | null): Promise<string> {
  // Never probe the backend's process directory for a chat with no workspace.
  if (!cwd?.trim() || cwd.trim() === ".") return "unknown"
  try {
    const status = (await gitStatus(cwd)) as { branch?: string }
    return status?.branch || "unknown"
  } catch {
    return "unknown"
  }
}

function normalizeProjectPath(projectPath?: string | null): string | null {
  const normalized = projectPath?.trim()
  return normalized ? normalized : null
}

function pendingKey(threadId: string, turnId?: string | null): string {
  return `${threadId}::${turnId || "active"}`
}

function findPendingTurnCheckpoint(
  state: CheckpointState,
  threadId: string,
  turnId?: string | null
): PendingTurnCheckpoint | null {
  const direct = state.pendingTurnCheckpoints[pendingKey(threadId, turnId)]
  if (direct) return direct
  const candidates = Object.values(state.pendingTurnCheckpoints)
    .filter((checkpoint) => checkpoint.threadId === threadId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return candidates[0] ?? null
}

function nextTurnNumber(state: CheckpointState, threadId: string): number {
  const completed = state.checkpoints
    .filter((checkpoint) => checkpoint.threadId === threadId)
    .map((checkpoint) =>
      typeof checkpoint.turnNumber === "number" ? checkpoint.turnNumber : -1
    )
  const pending = Object.values(state.pendingTurnCheckpoints)
    .filter((checkpoint) => checkpoint.threadId === threadId)
    .map((checkpoint) => checkpoint.turnNumber)
  return Math.max(-1, ...completed, ...pending) + 1
}

async function isUsableGitProject(cwd: string): Promise<boolean> {
  try {
    return await isGitRepo(cwd)
  } catch {
    return false
  }
}

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: [],
  pendingTurnCheckpoints: {},
  activeCheckpointId: null,
  isRestoring: false,

  createCheckpoint: (threadId, messageId, label, files, projectPath) => {
    const id = generateId()
    const checkpoint: Checkpoint = {
      id,
      threadId,
      messageId,
      label,
      timestamp: new Date().toISOString(),
      files,
      gitBranch: "unknown",
      ...(projectPath ? { projectPath } : {}),
    }

    getCurrentBranch(projectPath).then((branch) => {
      set((state) => ({
        checkpoints: state.checkpoints.map((cp) =>
          cp.id === id ? { ...cp, gitBranch: branch } : cp
        ),
      }))
    })

    set((state) => ({
      checkpoints: [...state.checkpoints, checkpoint],
      activeCheckpointId: id,
    }))

    return id
  },

  recordGitCheckpoint: (input) => {
    if (
      !input.threadId ||
      !input.messageId ||
      !input.projectPath ||
      !input.checkpointRef
    ) {
      return null
    }

    const existing = get().checkpoints.find(
      (checkpoint) =>
        checkpoint.threadId === input.threadId &&
        checkpoint.checkpointRef === input.checkpointRef
    )
    if (existing) {
      set((state) => ({
        checkpoints: state.checkpoints.map((checkpoint) =>
          checkpoint.id === existing.id
            ? {
                ...checkpoint,
                messageId: checkpoint.messageId || input.messageId,
                projectPath: input.projectPath,
                checkpointRef: input.checkpointRef,
                baseCheckpointRef:
                  input.baseCheckpointRef ?? checkpoint.baseCheckpointRef,
                turnId: input.turnId ?? checkpoint.turnId,
                turnNumber: input.turnNumber ?? checkpoint.turnNumber,
                diff: input.diff ?? checkpoint.diff,
                diffFiles: input.diffFiles ?? checkpoint.diffFiles,
              }
            : checkpoint
        ),
        activeCheckpointId: existing.id,
      }))
      return existing.id
    }

    const id = generateId()
    const checkpoint: Checkpoint = {
      id,
      threadId: input.threadId,
      messageId: input.messageId,
      label: input.label || "Turn checkpoint",
      timestamp: new Date().toISOString(),
      files: {},
      gitBranch: "unknown",
      projectPath: input.projectPath,
      checkpointRef: input.checkpointRef,
      baseCheckpointRef: input.baseCheckpointRef,
      turnId: input.turnId ?? null,
      turnNumber: input.turnNumber,
      diff: input.diff,
      diffFiles: input.diffFiles,
    }

    getCurrentBranch(input.projectPath).then((branch) => {
      set((state) => ({
        checkpoints: state.checkpoints.map((cp) =>
          cp.id === id ? { ...cp, gitBranch: branch } : cp
        ),
      }))
    })

    set((state) => ({
      checkpoints: [...state.checkpoints, checkpoint],
      activeCheckpointId: id,
    }))
    return id
  },

  restoreCheckpoint: async (checkpointId) => {
    const checkpoint = get().checkpoints.find((cp) => cp.id === checkpointId)
    if (!checkpoint) return

    set({ isRestoring: true })

    try {
      if (checkpoint.projectPath && checkpoint.checkpointRef) {
        if (typeof checkpoint.turnNumber !== "number") {
          throw new Error(
            "This Git checkpoint has no server turn boundary and cannot be restored safely."
          )
        }
        const result = await revertThreadCheckpoint(
          checkpoint.threadId,
          checkpoint.turnNumber
        )
        if (!result.reverted) {
          throw new Error(
            result.reason ??
              `Checkpoint turn ${checkpoint.turnNumber} could not be restored.`
          )
        }
        set({ activeCheckpointId: checkpointId })
        return
      }

      const writes = Object.entries(checkpoint.files).map(
        ([filePath, content]) => {
          const { cwd, relativePath } = splitPath(filePath)
          return writeFile(cwd, relativePath, content)
        }
      )
      if (writes.length === 0) {
        throw new Error("This checkpoint has no restorable file snapshot.")
      }
      await Promise.all(writes)
      set({ activeCheckpointId: checkpointId })
    } finally {
      set({ isRestoring: false })
    }
  },

  deleteCheckpoint: (id) => {
    // Hidden refs are owned by the backend checkpoint lifecycle. Removing a
    // renderer projection must never bypass its cleanup journal.
    set((state) => ({
      checkpoints: state.checkpoints.filter((cp) => cp.id !== id),
      activeCheckpointId:
        state.activeCheckpointId === id ? null : state.activeCheckpointId,
    }))
  },

  deleteCheckpointsAfter: (threadId, boundary) => {
    const messageIds = new Set(boundary.messageIds ?? [])
    const hasTurnBoundary = typeof boundary.turnNumber === "number"
    const checkpointsToDelete = get().checkpoints.filter((checkpoint) => {
      if (checkpoint.threadId !== threadId) return false
      if (messageIds.has(checkpoint.messageId)) return true
      return (
        hasTurnBoundary &&
        typeof checkpoint.turnNumber === "number" &&
        checkpoint.turnNumber > boundary.turnNumber!
      )
    })
    if (checkpointsToDelete.length === 0) return

    const idsToDelete = new Set(
      checkpointsToDelete.map((checkpoint) => checkpoint.id)
    )

    set((state) => ({
      checkpoints: state.checkpoints.filter(
        (checkpoint) => !idsToDelete.has(checkpoint.id)
      ),
      activeCheckpointId:
        state.activeCheckpointId && idsToDelete.has(state.activeCheckpointId)
          ? null
          : state.activeCheckpointId,
    }))
  },

  getCheckpointsForThread: (threadId) => {
    return get().checkpoints.filter((cp) => cp.threadId === threadId)
  },

  clearCheckpointsForThread: (threadId) => {
    set((state) => {
      const remaining = state.checkpoints.filter(
        (cp) => cp.threadId !== threadId
      )
      const cleared = state.checkpoints.some(
        (cp) => cp.threadId === threadId && cp.id === state.activeCheckpointId
      )
      return {
        checkpoints: remaining,
        pendingTurnCheckpoints: Object.fromEntries(
          Object.entries(state.pendingTurnCheckpoints).filter(
            ([, checkpoint]) => checkpoint.threadId !== threadId
          )
        ),
        activeCheckpointId: cleared ? null : state.activeCheckpointId,
      }
    })
  },

  captureTurnCheckpointStart: async ({
    threadId,
    turnId = null,
    projectPath,
  }) => {
    const cwd = normalizeProjectPath(projectPath)
    if (!cwd) return null

    const existing = findPendingTurnCheckpoint(get(), threadId, turnId)
    if (existing) return existing

    if (!(await isUsableGitProject(cwd))) return null

    const state = get()
    const turnNumber = nextTurnNumber(state, threadId)
    const baseCheckpointRef = checkpointRefForThreadTurn(
      threadId,
      turnNumber * 2
    )
    const checkpointRef = checkpointRefForThreadTurn(
      threadId,
      turnNumber * 2 + 1
    )
    const pending: PendingTurnCheckpoint = {
      threadId,
      turnId,
      projectPath: cwd,
      turnNumber,
      baseCheckpointRef,
      checkpointRef,
      startedAt: new Date().toISOString(),
    }

    try {
      await gitCaptureCheckpoint(cwd, baseCheckpointRef)
    } catch (error) {
      log.warn("Failed to capture git checkpoint baseline:", error)
      return null
    }

    set((current) => ({
      pendingTurnCheckpoints: {
        ...current.pendingTurnCheckpoints,
        [pendingKey(threadId, turnId)]: pending,
      },
    }))
    return pending
  },

  captureTurnCheckpointComplete: async ({
    threadId,
    messageId,
    turnId = null,
    projectPath,
    label,
  }) => {
    const state = get()
    const pending =
      findPendingTurnCheckpoint(state, threadId, turnId) ??
      (await get().captureTurnCheckpointStart({
        threadId,
        turnId,
        projectPath,
      }))
    if (!pending) return null

    try {
      await gitCaptureCheckpoint(pending.projectPath, pending.checkpointRef)
    } catch (error) {
      log.warn("Failed to capture git checkpoint completion:", error)
      get().discardTurnCheckpoint(threadId, turnId)
      return null
    }

    let diff = ""
    let diffFiles: TurnDiffFileSummary[] = []
    try {
      const result = await gitDiffCheckpoints(
        pending.projectPath,
        pending.baseCheckpointRef,
        pending.checkpointRef
      )
      diff = result.diff
      diffFiles = [...parseTurnDiffFilesFromUnifiedDiff(diff)]
    } catch (error) {
      log.warn("Failed to diff git checkpoints:", error)
    }

    const id = generateId()
    const checkpoint: Checkpoint = {
      id,
      threadId,
      messageId,
      label: label || "Turn checkpoint",
      timestamp: new Date().toISOString(),
      files: {},
      gitBranch: await getCurrentBranch(pending.projectPath),
      projectPath: pending.projectPath,
      checkpointRef: pending.checkpointRef,
      baseCheckpointRef: pending.baseCheckpointRef,
      turnId: pending.turnId,
      turnNumber: pending.turnNumber,
      diff,
      diffFiles,
    }

    set((current) => {
      const nextPending = { ...current.pendingTurnCheckpoints }
      delete nextPending[pendingKey(threadId, pending.turnId)]
      return {
        checkpoints: [...current.checkpoints, checkpoint],
        pendingTurnCheckpoints: nextPending,
        activeCheckpointId: id,
      }
    })
    return id
  },

  discardTurnCheckpoint: (threadId, turnId = null) => {
    set((state) => {
      const next = { ...state.pendingTurnCheckpoints }
      const key = pendingKey(threadId, turnId)
      if (next[key]) {
        delete next[key]
      } else {
        for (const [candidateKey, checkpoint] of Object.entries(next)) {
          if (checkpoint.threadId === threadId) delete next[candidateKey]
        }
      }
      return { pendingTurnCheckpoints: next }
    })
  },
}))

function extractFilePathsFromToolCalls(toolCalls: ToolCall[]): string[] {
  const paths = new Set<string>()

  for (const tc of toolCalls) {
    const name = (tc.name || "").toLowerCase()
    const isWrite =
      name.includes("write") || name.includes("edit") || name.includes("create")
    if (!isWrite) continue

    const input = tc.input as Record<string, unknown> | undefined
    if (!input) continue

    const filePath =
      (input.file_path as string) ||
      (input.path as string) ||
      (input.filePath as string)
    if (filePath) paths.add(filePath)
  }

  return Array.from(paths)
}

function buildLabel(filePaths: string[]): string {
  if (filePaths.length === 0) return "Checkpoint"
  const names = filePaths.map((p) => {
    const normalized = p.replace(/\\/g, "/")
    const parts = normalized.split("/")
    return parts.length > 1
      ? parts.slice(-2).join("/")
      : parts[parts.length - 1]
  })
  if (names.length === 1) return `Before editing ${names[0]}`
  if (names.length <= 3) return `Before editing ${names.join(", ")}`
  return `Before editing ${names.slice(0, 2).join(", ")} +${names.length - 2} more`
}

export async function autoCheckpointFromToolCalls(
  threadId: string,
  messageId: string,
  toolCalls: ToolCall[],
  projectPath?: string | null
): Promise<string | null> {
  const filePaths = extractFilePathsFromToolCalls(toolCalls)
  if (filePaths.length === 0) return null

  const files: Record<string, string> = {}

  const reads = filePaths.map(async (filePath) => {
    try {
      const result = await readFile(filePath)
      files[filePath] = result.content
    } catch {
      // File doesn't exist yet (new file creation) — skip
    }
  })
  await Promise.all(reads)

  if (Object.keys(files).length === 0) return null

  const label = buildLabel(filePaths)
  return useCheckpointStore
    .getState()
    .createCheckpoint(threadId, messageId, label, files, projectPath)
}
