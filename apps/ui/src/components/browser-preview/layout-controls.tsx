import { useCallback, useEffect, useState } from "react"
import Color from "color"
import {
  ChevronRightIcon,
  Columns3Icon,
  LayoutGridIcon,
  Rows3Icon,
  SquareIcon,
  SearchIcon,
  MoveHorizontalIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerOutput,
  ColorPickerFormat,
} from "@/components/kibo-ui/color-picker"
import { LAYOUT_OPTIONS } from "./constants"
import { StyleField } from "./style-field"

const fieldShellCls =
  "flex h-8 min-w-0 items-center gap-1 rounded-md border border-border/60 bg-input/30 px-2.5 transition-colors hover:border-border focus-within:border-ring"

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="border-b border-border/40"
    >
      <CollapsibleTrigger className="group flex h-10 w-full items-center justify-between px-3 text-[12px] font-medium transition-colors hover:bg-muted/30">
        {title}
        <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="betterc0de-collapsible-content">
        <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>
}

function OptionsSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  // Computed CSS can contain valid values outside the preset list (e.g. normal).
  const choices =
    value && !options.includes(value) ? [value, ...options] : options
  return (
    <div className="min-w-0 space-y-1">
      <span className="block text-[11px] leading-4 text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="w-full min-w-0 gap-1 rounded-md border-border/60 bg-input/30 px-2 text-[12px] font-normal data-[size=default]:h-8 [&_svg]:size-3"
        >
          <SelectValue placeholder="Select value" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string; icon?: React.ReactNode }[]
  value: T | null
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-0.5 rounded-lg bg-input/40 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex min-h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-ring",
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 text-[12px] text-muted-foreground">
      {label}
      <Switch checked={checked} onCheckedChange={onCheckedChange} size="sm" />
    </label>
  )
}

/** Try to parse any CSS color to hex. Falls back to #000000 for unparseable
 *  formats like lab(), oklch(), etc. */
function safeColorToHex(val: string): string {
  if (!val) return "#000000"
  // Already hex
  if (/^#[0-9a-fA-F]{3,8}$/.test(val)) return val
  try {
    return Color(val).hex()
  } catch {
    /* Expected: unparseable color format (lab, oklch, etc.) */
  }
  // Try extracting rgb values from rgb()/rgba()
  const rgbMatch = val.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (rgbMatch) {
    try {
      return Color.rgb(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]).hex()
    } catch {
      /* Expected: out-of-range RGB values */
    }
  }
  return "#000000"
}

function safeAlphaPercent(val: string): number {
  try {
    return Math.round(Color(val).alpha() * 100)
  } catch {
    return 100
  }
}

/** Swatch + hex + alpha on one 24px row, Figma-style. The alpha input is
 *  live-wired: values below 100 commit as rgba(), 100 commits plain hex. */
function ColorField({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string) => void
}) {
  const safeHex = safeColorToHex(value || "")
  const [hex, setHex] = useState(safeHex)
  const [alpha, setAlpha] = useState(String(safeAlphaPercent(value || "")))
  useEffect(() => {
    setHex(safeColorToHex(value || ""))
    setAlpha(String(safeAlphaPercent(value || "")))
  }, [value])

  const commitColor = useCallback(
    (nextHex: string, nextAlphaPct: number) => {
      try {
        const clamped = Math.min(100, Math.max(0, nextAlphaPct))
        const c = Color(nextHex).alpha(clamped / 100)
        onChange(clamped >= 100 ? c.hex() : c.rgb().string())
      } catch {
        /* Expected: half-typed hex value */
      }
    },
    [onChange]
  )

  const handlePickerChange = useCallback(
    (value: unknown) => {
      if (!Array.isArray(value) || value.length < 3) return
      try {
        const rgba = value as [number, number, number, number]
        const c = Color.rgb(
          Math.round(rgba[0]),
          Math.round(rgba[1]),
          Math.round(rgba[2])
        ).alpha(rgba[3] ?? 1)
        const h = c.hex()
        setHex(h)
        onChange(h)
      } catch {
        /* Expected: invalid RGBA values from color picker */
      }
    },
    [onChange]
  )

  return (
    <div className="flex h-10 items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Choose color"
            className="size-10 shrink-0 cursor-pointer rounded-md border border-border/50 transition-shadow hover:ring-2 hover:ring-ring/30"
            style={{ backgroundColor: hex || "transparent" }}
          />
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-56 p-3">
          <ColorPicker
            value={hex || "#000000"}
            onChange={handlePickerChange}
            className="gap-3"
          >
            <ColorPickerSelection className="h-32 rounded-lg" />
            <ColorPickerHue />
            <ColorPickerAlpha />
            <div className="flex items-center gap-1.5">
              <ColorPickerOutput />
              <ColorPickerEyeDropper className="size-8" />
            </div>
            <ColorPickerFormat />
          </ColorPicker>
        </PopoverContent>
      </Popover>
      <label className={cn(fieldShellCls, "flex-1")}>
        <input
          className="h-full w-full min-w-0 flex-1 bg-transparent font-mono text-[12px] uppercase outline-none"
          aria-label="Hex color"
          value={hex}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() =>
            commitColor(
              hex,
              Number.isFinite(parseFloat(alpha)) ? parseFloat(alpha) : 100
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter")
              commitColor(
                hex,
                Number.isFinite(parseFloat(alpha)) ? parseFloat(alpha) : 100
              )
          }}
        />
      </label>
      <label className={cn(fieldShellCls, "w-14 shrink-0")}>
        <input
          className="h-full w-full min-w-0 flex-1 bg-transparent text-right font-mono text-[12px] outline-none"
          aria-label="Color opacity"
          value={alpha}
          spellCheck={false}
          onChange={(e) => setAlpha(e.target.value)}
          onBlur={() =>
            commitColor(
              hex,
              Number.isFinite(parseFloat(alpha)) ? parseFloat(alpha) : 100
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter")
              commitColor(
                hex,
                Number.isFinite(parseFloat(alpha)) ? parseFloat(alpha) : 100
              )
          }}
        />
        <span className="shrink-0 text-[9px] text-muted-foreground select-none">
          %
        </span>
      </label>
    </div>
  )
}

interface LayoutControlsProps {
  styles: Record<string, string>
  onChange: (property: string, value: string) => void
}

export function LayoutControls({ styles, onChange }: LayoutControlsProps) {
  const [tab, setTab] = useState<"design" | "css">("design")
  const [cssFilter, setCssFilter] = useState("")
  const display = styles.display || "block"
  const isFlex = display === "flex" || display === "inline-flex"
  const isGrid = display === "grid" || display === "inline-grid"
  const flow = isFlex
    ? (styles["flex-direction"] || "row").startsWith("column")
      ? "column"
      : "row"
    : isGrid
      ? "grid"
      : display === "block"
        ? "block"
        : null
  const field = (
    property: string,
    label: string,
    options: {
      unit?: "px" | "%"
      min?: number
      max?: number
      numeric?: boolean
      placeholder?: string
    } = {}
  ) => (
    <StyleField
      label={label}
      value={styles[property]}
      {...options}
      onCommit={(value) => onChange(property, value)}
    />
  )
  const select = (
    property: string,
    label: string,
    options: readonly string[],
    fallback: string
  ) => (
    <OptionsSelect
      label={label}
      value={styles[property] || fallback}
      options={options}
      onChange={(value) => onChange(property, value)}
    />
  )
  const entries = Object.entries(styles)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([property, value]) =>
      (property + " " + value).toLowerCase().includes(cssFilter.toLowerCase())
    )

  return (
    <div className="pb-3" data-style-inspector>
      <div className="border-b border-border/40 px-3 py-2.5">
        <Segmented
          label="Style editor"
          options={[
            { value: "design", label: "Design" },
            { value: "css", label: "CSS" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === "css" ? (
        <>
          <div className="p-3">
            <label className={fieldShellCls}>
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                aria-label="Filter CSS properties"
                className="w-full min-w-0 bg-transparent text-[12px] outline-none"
                placeholder="Filter properties"
                value={cssFilter}
                onChange={(event) => setCssFilter(event.target.value)}
              />
            </label>
          </div>
          <div className="space-y-3 px-3">
            {entries.map(([property, value]) => (
              <StyleField
                key={property}
                label={property}
                value={value}
                onCommit={(next) => onChange(property, next)}
              />
            ))}
            {!entries.length && (
              <p className="py-3 text-[12px] text-muted-foreground">
                No matching properties
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[10px] leading-4 text-muted-foreground" title="Drag a field handle to adjust. Hold Shift for steps of 10, Alt for steps of 0.1. Press Escape to cancel.">
            <MoveHorizontalIcon className="size-3 shrink-0" />
            <span>Drag values</span>
            <span className="ml-auto">Shift ×10 · Alt ×0.1 · Esc</span>
          </div>
          <Section title="Size" defaultOpen>
            <Row>
              {field("width", "Width", { unit: "px", min: 0 })}
              {field("height", "Height", { unit: "px", min: 0 })}
            </Row>
          </Section>
          <Section title="Position">
            {select(
              "position",
              "Positioning",
              LAYOUT_OPTIONS.position,
              "static"
            )}
            <Row>
              {field("left", "Left (X)", { unit: "px" })}
              {field("top", "Top (Y)", { unit: "px" })}
            </Row>
            {field("z-index", "Layer (z-index)")}
          </Section>
          <Section title="Layout" defaultOpen>
            <Segmented
              label="Layout flow"
              value={flow}
              options={[
                {
                  value: "block",
                  label: "Block",
                  icon: <SquareIcon className="size-3.5" />,
                },
                {
                  value: "row",
                  label: "Row",
                  icon: <Columns3Icon className="size-3.5" />,
                },
                {
                  value: "column",
                  label: "Column",
                  icon: <Rows3Icon className="size-3.5" />,
                },
                {
                  value: "grid",
                  label: "Grid",
                  icon: <LayoutGridIcon className="size-3.5" />,
                },
              ]}
              onChange={(value) => {
                onChange(
                  "display",
                  value === "row" || value === "column" ? "flex" : value
                )
                if (value === "row" || value === "column")
                  onChange("flex-direction", value)
              }}
            />
            {isFlex && (
              <>
                <Row>
                  {select(
                    "justify-content",
                    "Main axis",
                    LAYOUT_OPTIONS.justifyContent,
                    "normal"
                  )}
                  {select(
                    "align-items",
                    "Cross axis",
                    LAYOUT_OPTIONS.alignItems,
                    "normal"
                  )}
                </Row>
                <Row>
                  {select(
                    "flex-wrap",
                    "Wrapping",
                    LAYOUT_OPTIONS.flexWrap,
                    "nowrap"
                  )}
                  {field("gap", "Gap", { unit: "px", min: 0 })}
                </Row>
              </>
            )}
            {isGrid && (
              <>
                {select(
                  "grid-template-columns",
                  "Columns",
                  LAYOUT_OPTIONS.gridTemplateColumns,
                  "1fr"
                )}
                {field("gap", "Gap", { unit: "px", min: 0 })}
              </>
            )}
          </Section>
          <Section title="Spacing" defaultOpen>
            {(["padding", "margin"] as const).map((property) => (
              <div key={property} className="space-y-2">
                <p className="flex items-center justify-between text-[11px] font-medium">
                  {property === "padding" ? "Padding" : "Margin"}
                  <span className="text-[10px] font-normal text-muted-foreground">{property === "padding" ? "Inside" : "Outside"}</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {["top", "right", "bottom", "left"].map((side) => (
                    <StyleField
                      key={side}
                      label={property + " " + side}
                      displayLabel={side[0].toUpperCase() + side.slice(1)}
                      unit="px"
                      min={property === "padding" ? 0 : undefined}
                      value={styles[property + "-" + side]}
                      onCommit={(value) =>
                        onChange(property + "-" + side, value)
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </Section>
          <Section title="Appearance">
            <Row>
              <StyleField
                label="Opacity"
                value={String(
                  Math.round(parseFloat(styles.opacity || "1") * 100)
                )}
                unit="%"
                min={0}
                max={100}
                onCommit={(value) => {
                  const n = parseFloat(value)
                  if (Number.isFinite(n))
                    onChange(
                      "opacity",
                      String(Math.min(1, Math.max(0, n / 100)))
                    )
                }}
              />
              {field("border-radius", "Corner radius", { unit: "px", min: 0 })}
            </Row>
            <ToggleRow
              label="Clip overflowing content"
              checked={styles.overflow === "hidden"}
              onCheckedChange={(checked) =>
                onChange("overflow", checked ? "hidden" : "visible")
              }
            />
            <ToggleRow
              label="Include padding in size"
              checked={styles["box-sizing"] === "border-box"}
              onCheckedChange={(checked) =>
                onChange("box-sizing", checked ? "border-box" : "content-box")
              }
            />
          </Section>
          <Section title="Typography">
            {field("font-family", "Font family", {
              numeric: false,
              placeholder: "Font family",
            })}
            <Row>
              {select(
                "font-weight",
                "Weight",
                ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
                "400"
              )}
              {field("font-size", "Font size", { unit: "px", min: 0 })}
            </Row>
            <ColorField
              value={styles.color}
              onChange={(value) => onChange("color", value)}
            />
            <Row>
              {field("line-height", "Line height", { min: 0 })}
              {field("letter-spacing", "Letter spacing", { unit: "px" })}
            </Row>
            <Segmented
              label="Text alignment"
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
                { value: "justify", label: "Justify" },
              ]}
              value={styles["text-align"] || "left"}
              onChange={(value) => onChange("text-align", value)}
            />
          </Section>
          <Section title="Background">
            <ColorField
              value={styles["background-color"]}
              onChange={(value) => onChange("background-color", value)}
            />
          </Section>
          <Section title="Border">
            {field("border", "Border shorthand", {
              numeric: false,
              placeholder: "1px solid #000",
            })}
            <Row>
              {field("border-width", "Width", { unit: "px", min: 0 })}
              {select(
                "border-style",
                "Style",
                ["none", "solid", "dashed", "dotted", "double"],
                "none"
              )}
            </Row>
            <ColorField
              value={styles["border-color"]}
              onChange={(value) => onChange("border-color", value)}
            />
          </Section>
          <Section title="Shadow & Blur">
            {field("box-shadow", "Shadow", {
              numeric: false,
              placeholder: "0 4px 12px rgba(0,0,0,.15)",
            })}
            {field("filter", "Filter", {
              numeric: false,
              placeholder: "blur(0px)",
            })}
            {field("backdrop-filter", "Backdrop filter", {
              numeric: false,
              placeholder: "blur(0px)",
            })}
          </Section>
          <Section title="Advanced">
            {select("display", "Display", LAYOUT_OPTIONS.display, "block")}
            {select("overflow", "Overflow", LAYOUT_OPTIONS.overflow, "visible")}
          </Section>
        </>
      )}
    </div>
  )
}
