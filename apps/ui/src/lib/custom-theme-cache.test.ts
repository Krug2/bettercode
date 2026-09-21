import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getCustomTheme,
  readCustomThemes,
  removeCustomTheme,
  writeCustomTheme,
} from "./custom-theme-cache"
import type { AppliedCustomTheme } from "./vscode-theme"

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

const applied: AppliedCustomTheme = {
  id: "dark-modern",
  name: "Dark Modern",
  mode: "dark",
  vars: { "--background": "#1f1f1f" },
  monaco: { base: "vs-dark", inherit: true, rules: [], colors: {} },
  shiki: { name: "betterc0de-dark-modern", displayName: "Dark Modern", type: "dark", colors: {}, tokenColors: [], semanticTokenColors: {} },
}

afterEach(() => vi.unstubAllGlobals())

describe("custom theme cache", () => {
  it("writes, reads, and removes themes; falls back to the default when active", () => {
    const storage = memoryStorage()
    vi.stubGlobal("localStorage", storage)
    expect(readCustomThemes()).toEqual({})
    writeCustomTheme(applied)
    expect(getCustomTheme("dark-modern")?.name).toBe("Dark Modern")
    expect(getCustomTheme("nope")).toBeNull()
    expect(getCustomTheme(null)).toBeNull()
    removeCustomTheme("dark-modern")
    expect(readCustomThemes()).toEqual({})
  })

  it("ignores corrupt or mismatched entries and survives blocked storage", () => {
    const storage = memoryStorage({
      "betterc0de-custom-themes": JSON.stringify({
        good: { ...applied, id: "good" },
        mismatched: { ...applied, id: "other" },
        junk: { id: "junk" },
      }),
    })
    vi.stubGlobal("localStorage", storage)
    expect(Object.keys(readCustomThemes())).toEqual(["good"])

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(readCustomThemes()).toEqual({})
    expect(() => writeCustomTheme(applied)).not.toThrow()
  })
})
