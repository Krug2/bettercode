import { describe, expect, it } from "vitest"
import {
  EDITOR_CHAT_PANEL_DEFAULT_WIDTH,
  clampEditorChatPanelWidth,
  clampEditorSidebarWidth,
} from "@/lib/editor-layout"

describe("editor layout sizing", () => {
  it("clamps editor chat width to an IDE side-panel range", () => {
    expect(clampEditorChatPanelWidth(220)).toBe(300)
    expect(clampEditorChatPanelWidth(600)).toBe(600)
    expect(clampEditorChatPanelWidth(900)).toBe(800)
  })

  it("uses 450px as the editor chat default", () => {
    expect(EDITOR_CHAT_PANEL_DEFAULT_WIDTH).toBe(450)
  })

  it("falls back to the compact editor chat default for invalid values", () => {
    expect(clampEditorChatPanelWidth(undefined)).toBe(
      EDITOR_CHAT_PANEL_DEFAULT_WIDTH
    )
    expect(clampEditorChatPanelWidth(Number.NaN)).toBe(
      EDITOR_CHAT_PANEL_DEFAULT_WIDTH
    )
  })

  it("migrates earlier editor chat defaults to the current width", () => {
    expect(clampEditorChatPanelWidth(384)).toBe(EDITOR_CHAT_PANEL_DEFAULT_WIDTH)
    expect(clampEditorChatPanelWidth(520)).toBe(EDITOR_CHAT_PANEL_DEFAULT_WIDTH)
  })

  it("keeps the editor explorer useful for nested paths and large displays", () => {
    expect(clampEditorSidebarWidth(160)).toBe(240)
    expect(clampEditorSidebarWidth(320)).toBe(320)
    expect(clampEditorSidebarWidth(900)).toBe(520)
  })
})
