import { afterEach, expect, it, vi } from "vitest"
import { useChatStore } from "@/lib/chat-store"
import { dispatchTerminalNewSession, terminalSessionTargetsPanel, TERMINAL_NEW_SESSION_EVENT, type TerminalNewSessionEventDetail } from "./terminal-events"

const panel = { id: "left-panel", mode: "agent" as const, threadId: "left" }
const initial = useChatStore.getState()
afterEach(() => { vi.unstubAllGlobals(); useChatStore.setState(initial, true) })

it("delivers a thread event only to its owner, even for a shared workspace", () => {
  const event = { threadId: "left", cwd: "C:/shared" }
  expect(terminalSessionTargetsPanel(event, panel)).toBe(true)
  expect(terminalSessionTargetsPanel(event, { ...panel, id: "right-panel", threadId: "right" })).toBe(false)
})
it("prioritizes an explicitly addressed terminal panel", () => {
  expect(terminalSessionTargetsPanel({ targetPanelId: "left-panel", threadId: "right" }, panel)).toBe(true)
  expect(terminalSessionTargetsPanel({ targetPanelId: "other", threadId: "left" }, panel)).toBe(false)
})
it("does not broadcast missing or empty chat identities to occupied panels", () => {
  expect(terminalSessionTargetsPanel({}, panel)).toBe(false)
  expect(terminalSessionTargetsPanel({ threadId: null }, panel)).toBe(false)
  expect(terminalSessionTargetsPanel({ mode: "editor", threadId: "left" }, panel)).toBe(false)
})
it("captures the focused chat at dispatch and preserves explicit destinations", () => {
  const target = new EventTarget()
  vi.stubGlobal("window", target)
  const events: TerminalNewSessionEventDetail[] = []
  target.addEventListener(TERMINAL_NEW_SESSION_EVENT, event => events.push((event as CustomEvent<TerminalNewSessionEventDetail>).detail))
  useChatStore.setState({ activeThreadId: "left" })
  dispatchTerminalNewSession()
  useChatStore.setState({ activeThreadId: "right" })
  dispatchTerminalNewSession({ threadId: "left" })
  dispatchTerminalNewSession({ threadId: null })
  expect(events.map(event => event.threadId)).toEqual(["left", "left", null])
})
