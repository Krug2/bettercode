import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PermissionMenuRow } from "@/components/chat/permission-menu-row"
import {
  PERMISSION_LEVELS,
  type PermissionLevelOption,
} from "@/components/chat/composer-mode-tables"

/**
 * The permission row is the one control that says how far an agent may act
 * without asking. Its wording has been rewritten several times; these tests
 * pin what the row must always show, and what it must never imply.
 */

function option(id: string): PermissionLevelOption {
  const found = PERMISSION_LEVELS.find((level) => level.id === id)
  if (!found) throw new Error(`no permission preset ${id}`)
  return found
}

function render(id: string, active = false): string {
  return renderToStaticMarkup(
    <PermissionMenuRow option={option(id)} active={active} />
  )
}

/** Lucide stamps its component name into the class list. */
function iconName(html: string): string {
  return html.match(/lucide-([a-z-]+)/)?.[1] ?? ""
}

describe("PermissionMenuRow", () => {
  it("shows the name and the explanation under it", () => {
    for (const level of PERMISSION_LEVELS) {
      const html = render(level.id)
      expect(html, level.id).toContain(level.label)
      expect(html, level.id).toContain(level.desc)
    }
  })

  it("marks only the selected row", () => {
    // The check is always rendered and toggled with opacity so the rows do not
    // shift width when the selection moves.
    expect(render("ask-on-edit", true)).toContain("opacity-100")
    expect(render("ask-on-edit", false)).toContain("opacity-0")
  })

  it("gives every preset its own icon", () => {
    const names = PERMISSION_LEVELS.map((level) => iconName(render(level.id)))
    expect(names.every(Boolean)).toBe(true)
    expect(new Set(names).size, names.join(",")).toBe(names.length)
  })

  it("names the unguarded preset with a disabled shield, not a warning sign", () => {
    // A warning triangle can mean anything. A shield switched off says the
    // guardrails are gone rather than merely loosened.
    expect(iconName(render("bypass"))).toBe("shield-off")
  })

  it("colours the unguarded preset and nothing else", () => {
    // The theme's destructive token rather than a literal red: the menu is
    // meant to look like the rest of the app, and one coloured row only reads
    // as a warning while the other four stay grey.
    expect(render("bypass")).toContain("text-destructive")
    for (const level of PERMISSION_LEVELS.filter((l) => !l.danger)) {
      expect(render(level.id), level.id).not.toContain("text-destructive")
    }
  })

  it("never lets a row claim more freedom than the gate grants", () => {
    // `evaluatePermission` auto-approves the write class only for this preset;
    // commands still surface an approval request.
    const html = render("allow-edits")
    expect(html).toMatch(/commands? still ask/i)
    expect(html).not.toMatch(/everything/i)
  })
})
