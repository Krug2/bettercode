import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { executeComposerPlan } from "./execute-composer-plan"
import { useChatStore } from "./chat-store"
import { usePreferencesStore } from "./preferences-store"
import { implementPendingPlanApproval } from "./plan-implement"

vi.mock("./plan-implement", () => ({ implementPendingPlanApproval: vi.fn() }))
const initialChat = useChatStore.getState()
const initialPrefs = usePreferencesStore.getState()
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(implementPendingPlanApproval).mockResolvedValue("no-approval")
  usePreferencesStore.setState({ selectedProviderId: "claude", selectedModel: "foreign-model", modelSelectionByProvider: {} })
  useChatStore.setState({
    activeThreadId: "other", streamingByThread: {},
    threads: ["owner", "other"].map(id => ({
      id, title: id, projectName: id, projectPath: `C:/${id}`, messages: [],
      createdAt: "2026-09-06", updatedAt: "2026-09-06",
    })),
    settingsByThread: {
      owner: { selectedProviderId: "codex", selectedModel: "gpt-6-astra", thinkingMode: "max", permissionLevel: "read-only", chatMode: "plan" },
      other: { chatMode: "ask", selectedModel: "foreign-model" },
    },
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
  useChatStore.setState(initialChat, true)
  usePreferencesStore.setState(initialPrefs, true)
})
const options = () => ({ threadId: "owner", content: "# Plan\n\nBuild the widget", sourceProposedPlan: null, inNewThread: false, submit: vi.fn() })

describe("plan execution ownership", () => {
  it("retains the plan owner across a focus switch during approval lookup", async () => {
    let finish!: (value: "no-approval") => void
    vi.mocked(implementPendingPlanApproval).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const input = options()
    const task = executeComposerPlan(input)
    useChatStore.setState({ activeThreadId: null })
    finish("no-approval")
    await task
    expect(implementPendingPlanApproval).toHaveBeenCalledWith("owner", { permissionMode: "acceptEdits" })
    expect(input.submit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "owner", chatModeOverride: "agent", files: [] }))
    expect(useChatStore.getState().settingsByThread.other.chatMode).toBe("ask")
  })

  it.each(["resolved", "in-flight", "error"] as const)("does not send another turn after %s", async (outcome) => {
    vi.mocked(implementPendingPlanApproval).mockResolvedValue(outcome)
    const input = options()
    await executeComposerPlan(input)
    expect(input.submit).not.toHaveBeenCalled()
  })

  it("inherits the owner's workspace and model when implementing in a new thread", async () => {
    const input = { ...options(), inNewThread: true }
    await executeComposerPlan(input)
    const targetId = input.submit.mock.calls[0][0].threadId
    expect(targetId).not.toBe("owner")
    expect(targetId).not.toBe("other")
    expect(useChatStore.getState().threads.find(thread => thread.id === targetId)?.projectPath).toBe("C:/owner")
    expect(useChatStore.getState().settingsByThread[targetId]).toMatchObject({ selectedProviderId: "codex", selectedModel: "gpt-6-astra", thinkingMode: "max", permissionLevel: "read-only", chatMode: "agent" })
    expect(implementPendingPlanApproval).not.toHaveBeenCalled()
  })

  it("never falls back to the focused thread if the owner was closed or is absent", async () => {
    const input = { ...options(), threadId: "missing" }
    await executeComposerPlan(input)
    expect(input.submit).not.toHaveBeenCalled()
    expect(implementPendingPlanApproval).not.toHaveBeenCalled()
  })

  it("gives a structured plan's source precedence over an unrelated modal context", async () => {
    const input = { ...options(), threadId: "other", sourceProposedPlan: { threadId: "owner", planId: "plan-1" } }
    await executeComposerPlan(input)
    expect(input.submit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "owner", sourceProposedPlan: input.sourceProposedPlan }))
  })
})
