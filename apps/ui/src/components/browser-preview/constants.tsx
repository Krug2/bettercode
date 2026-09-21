// [REFACTOR] Extracted from browser-preview-panel.tsx — static constants for
// the browser preview's device bar, tree highlighting, and layout editor.
// Kept as .tsx because DEVICE_PRESETS carries JSX icon elements.

import type { ReactNode } from "react"
import { MonitorIcon, TabletIcon, SmartphoneIcon } from "lucide-react"

export interface DevicePreset {
  label: string
  /** CSS width string — either "100%" or a pixel value like "768px". */
  width: string
  icon: ReactNode
}

export const DEVICE_PRESETS: DevicePreset[] = [
  {
    label: "Desktop",
    width: "100%",
    icon: <MonitorIcon className="size-3.5" />,
  },
  {
    label: "Tablet",
    width: "768px",
    icon: <TabletIcon className="size-3.5" />,
  },
  {
    label: "Mobile",
    width: "375px",
    icon: <SmartphoneIcon className="size-3.5" />,
  },
]

/**
 * Fixed-size artboard presets for the design-mode canvas. Unlike the editor's
 * DEVICE_PRESETS ("100%" fills the panel), artboards on an infinite canvas
 * need concrete pixel dimensions.
 */
export interface CanvasDevicePreset {
  id: "desktop" | "tablet" | "mobile"
  label: string
  width: number
  height: number
  icon: ReactNode
}

export const CANVAS_DEVICE_PRESETS: CanvasDevicePreset[] = [
  {
    id: "desktop",
    label: "Desktop",
    width: 1440,
    height: 900,
    icon: <MonitorIcon className="size-3.5" />,
  },
  {
    id: "tablet",
    label: "Tablet",
    width: 768,
    height: 1024,
    icon: <TabletIcon className="size-3.5" />,
  },
  {
    id: "mobile",
    label: "Mobile",
    width: 375,
    height: 812,
    icon: <SmartphoneIcon className="size-3.5" />,
  },
]

/** Color classes used to tint tag names in the inspector tree. */
export const TAG_COLORS: Record<string, string> = {
  div: "text-blue-600 dark:text-blue-400",
  section: "text-blue-600 dark:text-blue-400",
  main: "text-blue-600 dark:text-blue-400",
  article: "text-blue-600 dark:text-blue-400",
  aside: "text-blue-600 dark:text-blue-400",
  nav: "text-blue-600 dark:text-blue-400",
  header: "text-blue-600 dark:text-blue-400",
  footer: "text-blue-600 dark:text-blue-400",
  h1: "text-purple-600 dark:text-purple-400",
  h2: "text-purple-600 dark:text-purple-400",
  h3: "text-purple-600 dark:text-purple-400",
  h4: "text-purple-600 dark:text-purple-400",
  h5: "text-purple-600 dark:text-purple-400",
  h6: "text-purple-600 dark:text-purple-400",
  p: "text-emerald-700 dark:text-emerald-400",
  span: "text-emerald-700 dark:text-emerald-400",
  a: "text-cyan-700 dark:text-cyan-400",
  ul: "text-orange-700 dark:text-orange-400",
  ol: "text-orange-700 dark:text-orange-400",
  li: "text-orange-700 dark:text-orange-400",
  img: "text-pink-600 dark:text-pink-400",
  svg: "text-pink-600 dark:text-pink-400",
  video: "text-pink-600 dark:text-pink-400",
  form: "text-yellow-700 dark:text-yellow-400",
  input: "text-yellow-700 dark:text-yellow-400",
  button: "text-yellow-700 dark:text-yellow-400",
  textarea: "text-yellow-700 dark:text-yellow-400",
  select: "text-yellow-700 dark:text-yellow-400",
}

/** Value options offered by the layout editor's Select controls. */
export const LAYOUT_OPTIONS = {
  display: [
    "block",
    "flex",
    "grid",
    "inline",
    "inline-block",
    "inline-flex",
    "inline-grid",
    "none",
  ],
  flexDirection: ["row", "row-reverse", "column", "column-reverse"],
  flexWrap: ["nowrap", "wrap", "wrap-reverse"],
  justifyContent: [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ],
  alignItems: ["stretch", "flex-start", "flex-end", "center", "baseline"],
  position: ["static", "relative", "absolute", "fixed", "sticky"],
  overflow: ["visible", "hidden", "scroll", "auto"],
  gridTemplateColumns: [
    "1fr",
    "1fr 1fr",
    "1fr 1fr 1fr",
    "1fr 1fr 1fr 1fr",
    "repeat(auto-fill, minmax(200px, 1fr))",
  ],
  gridTemplateRows: ["auto", "1fr 1fr", "auto 1fr auto"],
}
