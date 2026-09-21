import { expect, it } from "vitest"
import { isRenameableIdentifier } from "./symbol-rename"
it.each(["2bad", "two words", "panel-title", "class", "await", "", " name "])(
  "rejects invalid binding %s",
  (value) => {
    expect(isRenameableIdentifier(value)).toBe(false)
  }
)
it.each(["Good_Name", "$value", "größe", "变量"])(
  "accepts valid binding %s",
  (value) => {
    expect(isRenameableIdentifier(value)).toBe(true)
  }
)
