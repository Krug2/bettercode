import { createRoot } from "react-dom/client"
import { TerminalPanel } from "@/components/terminal-panel"
import { useChatStore } from "@/lib/chat-store"
import { dispatchTerminalNewSession } from "@/lib/terminal-events"

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function until(read: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0
    const timeout = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error(label)) }, 5000)
    const check = () => {
      if (read()) { clearTimeout(timeout); resolve(); return }
      frame = requestAnimationFrame(check)
    }
    check()
  })
}
export async function runTerminalSmoke() {
  console.log("[smoke] Checking terminal event and working directory ownership")
  const root = createRoot(document.getElementById("root")!)
  const originalFetch = window.fetch
  const originalElectron = window.electronAPI
  const capabilities: { cwd?: string }[] = []
  window.electronAPI = { ...originalElectron, requestShellCapability: async (scope) => {
    capabilities.push({ cwd: "cwd" in scope ? scope.cwd : undefined })
    return "fixture-capability"
  } } as NonNullable<typeof window.electronAPI>
  const commands: { cwd?: string; command?: string }[] = []
  window.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith("/shell/detect")) return Response.json([{ id: "cmd", name: "CMD", default: true }])
    if (url.endsWith("/shell/run")) {
      commands.push(JSON.parse(String(init?.body)))
      return Response.json({ success: true, exitCode: 0, combined: "checked", stdout: "checked", stderr: "" })
    }
    return originalFetch(input, init)
  }
  const scope = (id: string) => document.querySelector<HTMLElement>(`[data-terminal-thread="${id}"]`)!
  const tabs = (id: string) => [...scope(id).querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.trim() === "CMD")
  const type = (id: string, text: string) => {
    const input = scope(id).querySelector("input")!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  const enter = (id: string) => scope(id).querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
  try {
    useChatStore.setState({ activeThreadId: "left" })
    root.render(<div><TerminalPanel open threadId="left" cwd="C:/shared" onClose={() => {}} /><TerminalPanel open threadId="right" cwd="C:/shared" onClose={() => {}} /></div>)
    await until(() => Boolean(scope("left") && scope("right")), "Both terminals must mount")
    dispatchTerminalNewSession({ threadId: "right", cwd: "C:/right-worktree", initialCommand: "right command" })
    await until(() => tabs("right").length === 2, "Right terminal must receive its new session")
    assert(tabs("left").length === 1, "Shared workspaces must not broadcast terminal sessions")
    assert(scope("right").querySelector("input")!.value === "right command", "Prefilled command must remain in the right terminal")
    assert(commands.length === 0, "Prefilled commands must not execute automatically")
    type("right", "cd nested")
    await until(() => scope("right").querySelector("input")!.value === "cd nested", "Terminal input must update")
    enter("right")
    await until(() => Boolean(scope("right").textContent?.includes("C:/right-worktree/nested")), "cd must update this session's cwd")
    tabs("right")[0].click()
    await until(() => !scope("right").textContent?.includes("C:/right-worktree/nested"), "First terminal session must be selected")
    tabs("right")[1].click()
    await until(() => Boolean(scope("right").textContent?.includes("C:/right-worktree/nested")), "Returning must select the session with its history")
    type("right", "echo check")
    await until(() => scope("right").querySelector("input")!.value === "echo check", "Command input must update")
    enter("right")
    await until(() => commands.length === 1, "Explicit Enter must execute one command")
    assert(commands[0].cwd === "C:/right-worktree/nested", "Tab switching must preserve cd and the explicit worktree")
    assert(capabilities.length === 1 && capabilities[0].cwd === commands[0].cwd, "Manual execution must request a capability scoped to this session")
    dispatchTerminalNewSession({ targetPanelId: scope("left").dataset.terminalPanelId, threadId: "right" })
    await until(() => tabs("left").length === 2, "Explicit keyboard target must take priority")
    assert(tabs("right").length === 2, "Keyboard targeting must not create a second session elsewhere")
  } finally {
    root.unmount()
    window.fetch = originalFetch
    window.electronAPI = originalElectron
  }
}
