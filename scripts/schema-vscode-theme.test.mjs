import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const { parseJsonc, resolveVsCodeThemeMode } = require("@betterc0de/schema")

test("theme JSONC permits comments between trailing commas and closing containers", () => {
  assert.deepEqual(parseJsonc(`{
    "url": "https://example.com/a/*literal*/",
    "colors": ["#fff", /* trailing entry */ // another comment
    ], // trailing property
  }`), { url: "https://example.com/a/*literal*/", colors: ["#fff"] })
  assert.throws(() => parseJsonc('{"count":1/* separator */2}'))
  assert.throws(() => parseJsonc('{} /* unterminated'))
})

test("explicit high-contrast theme mode takes precedence over conflicting swatches", () => {
  assert.equal(resolveVsCodeThemeMode({ type: "hcLight", colors: { "editor.background": "#000" } }), "light")
  assert.equal(resolveVsCodeThemeMode({ type: "hcDark", colors: { "editor.background": "#fff" } }), "dark")
})
