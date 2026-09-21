import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { StyleField } from "./style-field"
import { LayoutControls } from "./layout-controls"

describe("style inspector controls", () => {
  it("exposes a named numeric input with bounds and a discoverable drag handle", () => {
    const html = renderToStaticMarkup(
      <StyleField
        label="Width"
        value="255px"
        unit="px"
        min={0}
        onCommit={() => {}}
      />
    )
    expect(html).toContain('aria-label="Adjust Width"')
    expect(html).toContain('role="spinbutton"')
    expect(html).toContain('aria-valuenow="255"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain("Shift")
    expect(html).not.toContain('value="255px"')
  })
  it("does not turn CSS expressions or keywords into draggable numbers", () => {
    const html = renderToStaticMarkup(
      <StyleField label="Width" value="auto" unit="px" onCommit={() => {}} />
    )
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('role="spinbutton"')
    expect(html).toContain('value="auto"')
  })
  it("labels each spacing side separately and exposes the selected layout", () => {
    const html = renderToStaticMarkup(
      <LayoutControls
        styles={{
          display: "flex",
          "flex-direction": "column",
          width: "255px",
          height: "444px",
          "justify-content": "normal",
          "align-items": "normal",
        }}
        onChange={() => {}}
      />
    )
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(html).toContain(`data-style-field="padding ${side}"`)
      expect(html).toContain(`data-style-field="margin ${side}"`)
    }
    expect(html).toContain('aria-label="Layout flow"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Main axis"')
    expect(html).toContain('aria-label="Cross axis"')
  })
})
