import { describe, expect, it } from "vitest"
import { getComposerControlVisibility } from "@/lib/composer-responsive"

describe("composer control visibility", () => {
  it("keeps model and thinking visible at the 450px editor baseline", () => {
    expect(getComposerControlVisibility(450)).toEqual({
      showEssentialControls: true,
      showPermissionControl: false,
    })
  })

  it("moves essential controls into overflow only when space is genuinely tight", () => {
    expect(getComposerControlVisibility(360)).toEqual({
      showEssentialControls: false,
      showPermissionControl: false,
    })
  })

  it("shows the complete footer on wide chat panels", () => {
    expect(getComposerControlVisibility(700)).toEqual({
      showEssentialControls: true,
      showPermissionControl: true,
    })
  })

  it("does not collapse controls before the first measurement", () => {
    expect(getComposerControlVisibility(0)).toEqual({
      showEssentialControls: true,
      showPermissionControl: true,
    })
  })
})
