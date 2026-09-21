import { describe, expect, it } from "vitest"
import {
  PERMISSION_LEVELS,
  permissionLevelLabel,
} from "@/components/chat/composer-mode-tables"

/**
 * Composer presets combine approval policy and filesystem access. Each label
 * must describe the policy enforced by the backend, including read-only mode.
 *
 * These tests exist because the labels drifted from the behaviour once
 * already: "Full Access" claimed to auto-approve commands while the gate only
 * ever auto-approved writes. A label that overstates permission is worse than
 * no label.
 */

function option(id: string) {
  const found = PERMISSION_LEVELS.find((level) => level.id === id)
  if (!found) throw new Error(`no permission preset ${id}`)
  return found
}

describe("permission presets", () => {
  it("offers exactly the five presets the gate can enforce", () => {
    expect(PERMISSION_LEVELS.map((level) => level.id)).toEqual([
      "ask-on-edit",
      "allow-edits",
      "default",
      "read-only",
      "bypass",
    ])
  })

  it("orders them from most supervised to least", () => {
    // The user reads top-to-bottom and the danger option must be last.
    expect(PERMISSION_LEVELS[0]?.id).toBe("ask-on-edit")
    expect(PERMISSION_LEVELS.at(-1)?.id).toBe("bypass")
  })

  it("marks only the guardrail-free preset as dangerous", () => {
    const dangerous = PERMISSION_LEVELS.filter((level) => level.danger)
    expect(dangerous.map((level) => level.id)).toEqual(["bypass"])
  })

  it("does not claim auto-accept-edits approves commands", () => {
    // `evaluatePermission` auto-allows the write class only; commands fall
    // through to "ask". The copy has to say so.
    const auto = option("allow-edits")
    expect(auto.label).not.toMatch(/full/i)
    expect(auto.desc).toMatch(/command/i)
    expect(auto.desc).toMatch(/ask/i)
  })

  it("keeps read-only honest about still allowing reads", () => {
    // Read-only is meant to be usable, not merely safe: search and read must
    // stay available or the mode is pointless.
    const readOnly = option("read-only")
    expect(readOnly.desc).toMatch(/read/i)
    expect(readOnly.desc).toMatch(/never modif|no writes|nothing.*change/i)
  })

  it("labels the composer chip from the same table the menu renders", () => {
    // Both footers used to carry their own hand-written wording for the chip.
    // They drifted: the chip said "Full access" for the preset the menu called
    // something else, so the visible state contradicted the checked row.
    for (const level of PERMISSION_LEVELS) {
      expect(permissionLevelLabel(level.id), level.id).toBe(level.label)
    }
  })

  it("falls back to the most supervised preset for an unknown value", () => {
    // Never show a permissive label for a value we do not recognise.
    for (const junk of [undefined, null, "", "  ", "nonsense"]) {
      expect(permissionLevelLabel(junk), String(junk)).toBe(
        PERMISSION_LEVELS[0]?.label
      )
    }
  })

  it("gives every preset a distinct label and a description", () => {
    const labels = PERMISSION_LEVELS.map((level) => level.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const level of PERMISSION_LEVELS) {
      expect(level.desc.trim().length, level.id).toBeGreaterThan(0)
    }
  })
})
