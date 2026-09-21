import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConsolePanel } from "./console-panel"

const reportState = vi.hoisted(() => ({
  pending: false,
  cooldownSeconds: 0,
  feedback: null as { ok: boolean; message: string } | null,
  send: vi.fn(),
}))
vi.mock("@/services/bug-report", () => ({ useBugReportStore: () => reportState }))

beforeEach(() => {
  reportState.pending = false
  reportState.cooldownSeconds = 0
  reportState.feedback = null
  reportState.send.mockClear()
})

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
}))

function render(consoleTab: "console" | "report") {
  return renderToStaticMarkup(createElement(ConsolePanel, {
    consolePanelHeight: 300, setConsolePanelHeight: vi.fn(), consolePanelOpen: true,
    setConsolePanelOpen: vi.fn(), consoleTab, setConsoleTab: vi.fn(), setConsoleLogs: vi.fn(),
    activeThread: null, selectedModel: null, messageCount: 0,
    consoleLogs: Array.from({ length: 7 }, (_, index) => ({ type: "warn" as const, message: `Warning ${index + 1}`, timestamp: new Date("2026-09-14T00:00:00Z") })),
  }))
}
describe("diagnostic copying", () => {
  it.each(["console", "report"] as const)("makes every %s message selectable and individually copyable", tab => {
    const html = render(tab)
    expect(html).toContain("select-text")
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(7)
    expect(html).toContain("Warning 7")
    expect(html).not.toContain("Message copied")
  })
})

describe("report sending controls", () => {
  it("offers manual sending in the report tab without sending during render", () => {
    const html = render("report")
    expect(html).toContain("Send Report")
    expect(html).toContain("Copy Report")
    expect(html).not.toContain("disabled=\"\"")
    expect(render("console")).not.toContain("Send Report")
    expect(reportState.send).not.toHaveBeenCalled()
  })

  it("disables sending during the request and countdown", () => {
    reportState.pending = true
    expect(render("report")).toContain("Sending…")
    expect(render("report")).toContain("aria-busy=\"true\"")
    expect(render("report")).toContain("disabled=\"\"")
    reportState.pending = false
    reportState.cooldownSeconds = 8
    expect(render("report")).toContain("Send in 8s")
    expect(render("report")).toContain("disabled=\"\"")
  })

  it.each([true, false])("announces the send result (success: %s)", (ok) => {
    reportState.feedback = { ok, message: ok ? "Report sent. Thank you!" : "Report could not be sent." }
    expect(render("report")).toContain(`role="status"`)
    expect(render("report")).toContain(reportState.feedback.message)
  })
})
