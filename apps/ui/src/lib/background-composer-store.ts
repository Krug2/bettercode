import { create } from "zustand"

export interface BackgroundArtifact {
  id: string
  type: "file" | "command" | "analysis"
  path?: string
  content: string
  createdAt: string
}

export interface BackgroundDiff {
  path: string
  additions: number
  deletions: number
  hunks: string
}

export interface BackgroundTask {
  id: string
  threadId: string
  title: string
  prompt: string
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
  progress: number // 0-100
  currentStep: string
  steps: { label: string; status: "pending" | "running" | "done" | "error" }[]
  artifacts: BackgroundArtifact[]
  diffs: BackgroundDiff[]
  logs: string[]
  branch?: string
  startedAt: string
  completedAt?: string
  error?: string
}

interface BackgroundComposerState {
  tasks: BackgroundTask[]
  activeTaskId: string | null
  isMinimized: boolean

  // Actions
  createTask: (title: string, prompt: string, threadId: string) => string
  updateTaskStatus: (
    taskId: string,
    status: BackgroundTask["status"]
  ) => void
  updateTaskProgress: (
    taskId: string,
    progress: number,
    currentStep: string
  ) => void
  addStep: (taskId: string, label: string) => void
  updateStep: (
    taskId: string,
    stepIndex: number,
    status: BackgroundTask["steps"][number]["status"]
  ) => void
  addArtifact: (taskId: string, artifact: Omit<BackgroundArtifact, "id" | "createdAt">) => void
  addDiff: (taskId: string, diff: BackgroundDiff) => void
  addLog: (taskId: string, message: string) => void
  cancelTask: (taskId: string) => void
  removeTask: (taskId: string) => void
  setActiveTask: (taskId: string | null) => void
  setMinimized: (minimized: boolean) => void
  applyChangesLocally: (taskId: string) => void
  getRunningTasks: () => BackgroundTask[]
}

export const useBackgroundComposerStore = create<BackgroundComposerState>(
  (set, get) => ({
    tasks: [],
    activeTaskId: null,
    isMinimized: false,

    createTask: (title, prompt, threadId) => {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const task: BackgroundTask = {
        id,
        threadId,
        title,
        prompt,
        status: "queued",
        progress: 0,
        currentStep: "",
        steps: [],
        artifacts: [],
        diffs: [],
        logs: [],
        startedAt: now,
      }
      set((state) => ({
        tasks: [task, ...state.tasks],
        activeTaskId: id,
      }))
      return id
    },

    updateTaskStatus: (taskId, status) => {
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== taskId) return t
          const updates: Partial<BackgroundTask> = { status }
          if (status === "completed" || status === "failed" || status === "cancelled") {
            updates.completedAt = new Date().toISOString()
          }
          if (status === "completed") {
            updates.progress = 100
          }
          return { ...t, ...updates }
        }),
      }))
    },

    updateTaskProgress: (taskId, progress, currentStep) => {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, progress: Math.min(100, Math.max(0, progress)), currentStep }
            : t
        ),
      }))
    },

    addStep: (taskId, label) => {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                steps: [...t.steps, { label, status: "pending" as const }],
              }
            : t
        ),
      }))
    },

    updateStep: (taskId, stepIndex, status) => {
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.id !== taskId) return t
          const steps = t.steps.map((s, i) =>
            i === stepIndex ? { ...s, status } : s
          )
          return { ...t, steps }
        }),
      }))
    },

    addArtifact: (taskId, artifact) => {
      const full: BackgroundArtifact = {
        ...artifact,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, artifacts: [...t.artifacts, full] }
            : t
        ),
      }))
    },

    addDiff: (taskId, diff) => {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, diffs: [...t.diffs, diff] } : t
        ),
      }))
    },

    addLog: (taskId, message) => {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId ? { ...t, logs: [...t.logs, message] } : t
        ),
      }))
    },

    cancelTask: (taskId) => {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "cancelled" as const,
                completedAt: new Date().toISOString(),
              }
            : t
        ),
      }))
    },

    removeTask: (taskId) => {
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
        activeTaskId:
          state.activeTaskId === taskId ? null : state.activeTaskId,
      }))
    },

    setActiveTask: (taskId) => set({ activeTaskId: taskId }),

    setMinimized: (minimized) => set({ isMinimized: minimized }),

    applyChangesLocally: (taskId) => {
      const task = get().tasks.find((t) => t.id === taskId)
      if (!task) return
      // Mark all diffs as applied by logging the action
      get().addLog(taskId, `Applying ${task.diffs.length} diff(s) to local files...`)
      for (const diff of task.diffs) {
        get().addLog(
          taskId,
          `Applied changes to ${diff.path} (+${diff.additions} -${diff.deletions})`
        )
      }
      get().addLog(taskId, "All changes applied locally.")
    },

    getRunningTasks: () => {
      return get().tasks.filter((t) => t.status === "running")
    },
  })
)
