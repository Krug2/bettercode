import { StrictMode } from "react"
import type { Root } from "react-dom/client"
import { FileChangesBar } from "@/components/ai-elements/file-changes-bar"
import { emptyStreamState, useChatStore } from "@/lib/chat-store"
import { useCheckpointStore, type Checkpoint } from "@/lib/checkpoint-store"

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function eventually(read: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => check())
    let frame = 0
    const cleanup = () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for file review state"))
    }, 5000)
    const check = () => {
      try {
        if (read()) { cleanup(); resolve(); return }
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(check)
      } catch (error) { cleanup(); reject(error) }
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
    check()
  })
}

export async function runFileReviewSmoke(root: Root) {
  root.render(null)
  await eventually(() => document.getElementById("root")!.childElementCount === 0)
  console.log("[smoke] Model fixture unmounted")
  const diff = { path: "src/shared.ts", additions: 1, deletions: 1, oldText: "", newText: "edited", isNew: false }
  const writes: { cwd: string; relativePath: string; contents: string }[] = []
  const reads: { cwd: string; relativePath: string }[] = []
  let finishWrite: ((response: Response) => void) | undefined
  const originalFetch = window.fetch
  window.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith("/workspace/write")) {
      writes.push(JSON.parse(String(init?.body)))
      return new Promise<Response>(resolve => { finishWrite = resolve })
    }
    if (url.endsWith("/workspace/read")) {
      reads.push(JSON.parse(String(init?.body)))
      return Response.json({ content: "edited", path: "C:/worktree-owner/src/shared.ts" })
    }
    return originalFetch(input, init)
  }
  const checkpoints = (turnId: string): Checkpoint[] => [
    { id: "owner-snapshot", threadId: "owner", messageId: "owner-message", turnId,
      files: { "C:\\worktree-owner\\src\\shared.ts": "" }, label: "Before edit", timestamp: "2026-09-05", gitBranch: "main" },
    { id: "other-snapshot", threadId: "other", messageId: "other-message", turnId,
      files: { "src/shared.ts": "OTHER CHAT CONTENT" }, label: "Before edit", timestamp: "2026-09-05", gitBranch: "main" },
  ]
  const startTurn = (turnId: string) => {
    useCheckpointStore.setState({ checkpoints: checkpoints(turnId) })
    useChatStore.setState(state => ({
      streamingByThread: { ...state.streamingByThread, owner: {
        ...emptyStreamState, isStreaming: true, activeTurnId: turnId, streamingDiffs: [{ ...diff }],
      } },
    }))
  }
  useChatStore.setState({
    activeThreadId: "other",
    threads: ["owner", "other", "empty"].map(id => ({
      id, title: id, projectName: "Same project", projectPath: "C:/shared-project",
      worktreePath: id === "owner" ? "C:/worktree-owner" : undefined,
      createdAt: "2026-09-05", updatedAt: "2026-09-05", messages: [],
    })),
    streamingByThread: { other: { ...emptyStreamState, activeTurnId: "other-turn", streamingDiffs: [diff] } },
  })
  startTurn("owner-turn-1")
  const otherStream = useChatStore.getState().streamingByThread.other
  const render = (firstThread: string | null = "owner") => root.render(
    <StrictMode>
      <section data-review-pane="owner"><FileChangesBar threadId={firstThread} /></section>
      <section data-review-pane="other"><FileChangesBar threadId="other" /></section>
      <section data-review-pane="empty"><FileChangesBar threadId="empty" /></section>
      <section data-review-pane="blank"><FileChangesBar threadId={null} /></section>
    </StrictMode>
  )
  const pane = (id: string) => document.querySelector<HTMLElement>(`[data-review-pane="${id}"]`)!
  const review = (id: string) => pane(id)?.querySelector<HTMLElement>("[data-review-thread]")
  const button = (id: string, selector: string) => {
    const control = pane(id).querySelector<HTMLButtonElement>(selector)
    assert(control, `Missing ${id} review control ${selector}`)
    return control
  }
  try {
    render()
    await eventually(() => Boolean(review("owner") && review("other")))
    console.log("[smoke] File reviews mounted")
    assert(!review("empty") && !review("blank"), "Empty chats must not borrow another chat's review")
    assert(review("owner")!.dataset.reviewThread === "owner", "Review must belong to its pane")
    button("owner", '[title="Open in editor"]').click()
    await eventually(() => reads.length > 0)
    console.log("[smoke] Owner file opened")
    assert(`${reads[0].cwd}/${reads[0].relativePath}` === "C:/worktree-owner/src/shared.ts", "Open must use the owner's worktree while another chat is focused")

    button("owner", '[aria-label="Dismiss"]').click()
    await eventually(() => !review("owner"))
    assert(review("other"), "Dismissing one pane must not hide the other")
    assert(useChatStore.getState().streamingByThread.owner.streamingDiffs.length === 1, "Dismiss must retain diffs for provider finalization")
    assert(useChatStore.getState().streamingByThread.other === otherStream, "Dismiss must not mutate another stream")
    // Finishing the same turn keeps it dismissed; a fresh turn can be reviewed.
    useChatStore.setState(state => ({
      threads: state.threads.map(thread => thread.id === "owner" ? { ...thread, messages: [{
        id: "owner-message", role: "assistant", content: "Done", createdAt: "2026-09-05", turnId: "owner-turn-1", diffs: [diff],
      }] } : thread),
      streamingByThread: { ...state.streamingByThread, owner: { ...emptyStreamState } },
    }))
    render()
    await eventually(() => !review("owner"))
    startTurn("owner-turn-2")
    await eventually(() => Boolean(review("owner")))
    button("owner", '[title="Accept changes"]').click()
    useChatStore.setState({ activeThreadId: "empty" })
    await eventually(() => !review("owner"))
    assert(review("other"), "Accepting a file must leave the other pane's review intact")

    startTurn("owner-turn-3")
    console.log("[smoke] Dismiss and accept isolated")
    await eventually(() => Boolean(review("owner")))
    const reject = button("owner", '[title="Reject & revert changes"]')
    reject.click()
    reject.click()
    await eventually(() => writes.length > 0)
    assert(writes.length === 1, "Repeated clicks must not dispatch duplicate restores")
    assert(writes[0].cwd === "C:/worktree-owner" && writes[0].relativePath === "src/shared.ts", "Reject must target the owner's worktree")
    assert(writes[0].contents === "", "Reject must use the owner's empty snapshot, never the newer foreign checkpoint")
    assert(!pane("owner").textContent?.includes("Rejected"), "Do not report success while the backend write is pending")
    useChatStore.setState({ activeThreadId: "other" })
    finishWrite!(new Response(null, { status: 204 }))
    await eventually(() => !review("owner"))
    assert(useChatStore.getState().streamingByThread.other === otherStream, "Async completion must not mutate the focused chat")
    assert(review("other"), "Reject must leave the other review visible")

    startTurn("owner-turn-4")
    console.log("[smoke] Revert isolated")
    await eventually(() => Boolean(review("owner")))
    button("owner", '[title="Reject & revert changes"]').click()
    await eventually(() => writes.length === 2)
    finishWrite!(Response.json({ error: "Permission denied" }, { status: 403 }))
    await eventually(() => Boolean(pane("owner").querySelector('[role="alert"]')))
    assert(!pane("owner").textContent?.includes("Rejected"), "A denied write must not appear rejected")
    assert(!pane("other").querySelector('[role="alert"]'), "Revert errors belong only to their originating review")

    startTurn("owner-turn-5")
    useCheckpointStore.setState({ checkpoints: [checkpoints("owner-turn-5")[1], checkpoints("older-owner-turn")[0]] })
    await eventually(() => !pane("owner").querySelector('[role="alert"]'))
    button("owner", '[title="Reject & revert changes"]').click()
    await eventually(() => Boolean(pane("owner").querySelector('[role="alert"]')))
    assert(Number(writes.length) === 2, "A missing snapshot must not restore a foreign chat or an earlier turn")

    // A tab switch on the same panel must also drop its previous verdict/error.
    render("empty")
    await eventually(() => !review("owner"))
    assert(review("other"), "Switching one panel's tab must leave the other review intact")
    render("owner")
    await eventually(() => Boolean(review("owner")))
    assert(!pane("owner").querySelector('[role="alert"]'), "New review mounts must not inherit another tab's error")
  } finally {
    finishWrite?.(new Response(null, { status: 204 }))
    window.fetch = originalFetch
    root.unmount()
  }
}
