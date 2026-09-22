export const EDITOR_CHAT_PANEL_DEFAULT_WIDTH = 450
export const EDITOR_CHAT_PANEL_MIN_WIDTH = 300
export const EDITOR_CHAT_PANEL_MAX_WIDTH = 800
const LEGACY_EDITOR_CHAT_PANEL_DEFAULT_WIDTHS = new Set([384, 520])

export const EDITOR_SIDEBAR_MIN_WIDTH = 240
export const EDITOR_SIDEBAR_MAX_WIDTH = 520

// Agent-mode left sidebar bounds (mirrors the resize clamp in left-sidebar.tsx).
export const AGENT_SIDEBAR_MIN_WIDTH = 220
export const AGENT_SIDEBAR_MAX_WIDTH = 500

// Stored sidebar widths are tuned against a 1920px-wide reference display.
// Rendering them as `vw` keeps the sidebar the same proportion of the screen
// on any resolution (laptop → ultrawide); the clamp keeps it usable at the
// extremes. 1920 / 100 = 19.2px per 1vw at the reference width.
export const SIDEBAR_REFERENCE_VIEWPORT = 1920

// Above this viewport width the agent sidebar scales its contents up (via the
// `.betterc0de-left-sidebar-scale` zoom rule in index.css) so the controls stay
// comfortable on larger displays. Keep these in sync with that media query.
export const SIDEBAR_WIDE_BREAKPOINT = 1080
export const SIDEBAR_WIDE_SCALE = 1.15

export function clampEditorChatPanelWidth(value: unknown): number {
  if (
    typeof value === "number" &&
    LEGACY_EDITOR_CHAT_PANEL_DEFAULT_WIDTHS.has(value)
  ) {
    return EDITOR_CHAT_PANEL_DEFAULT_WIDTH
  }

  return clampNumber(
    value,
    EDITOR_CHAT_PANEL_DEFAULT_WIDTH,
    EDITOR_CHAT_PANEL_MIN_WIDTH,
    EDITOR_CHAT_PANEL_MAX_WIDTH
  )
}

export function clampEditorSidebarWidth(value: unknown): number {
  return clampNumber(
    value,
    300,
    EDITOR_SIDEBAR_MIN_WIDTH,
    EDITOR_SIDEBAR_MAX_WIDTH
  )
}

// Convert a reference-px sidebar width into a responsive `vw`-based CSS width,
// clamped to [minPx, maxPx] so it never becomes unusably narrow or wide.
export function responsiveSidebarWidth(
  widthPx: number,
  minPx: number,
  maxPx: number
): string {
  const vw = (widthPx / SIDEBAR_REFERENCE_VIEWPORT) * 100
  return `clamp(${minPx}px, ${vw.toFixed(3)}vw, ${maxPx}px)`
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const number =
    typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}
