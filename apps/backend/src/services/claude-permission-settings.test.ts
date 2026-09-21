import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deleteClaudePermissionRule, listClaudePermissionRules } from "./claude-permission-settings"

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-claude-settings-"))
  directories.push(homeDir)
  const settingsDirectory = path.join(homeDir, ".claude")
  fs.mkdirSync(settingsDirectory)
  const file = path.join(settingsDirectory, "settings.json")
  const settings = { permissions: { allow: ["Read", "Edit"], deny: ["Bash"] }, env: { EXAMPLE_TOKEN: "private-value" } }
  fs.writeFileSync(file, JSON.stringify(settings), { mode: 0o600 })
  return { homeDir, settingsDirectory, file, settings }
}

describe("Claude permission settings persistence", () => {
  it("removes only the requested rule without widening file permissions", () => {
    const { homeDir, settingsDirectory, file, settings } = fixture()
    const mode = fs.statSync(file).mode & 0o777
    const open = vi.spyOn(fs, "openSync")

    expect(deleteClaudePermissionRule({ homeDir, source: "userSettings", behavior: "allow", rule: "Read" })).toBe(true)

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ ...settings, permissions: { allow: ["Edit"], deny: ["Bash"] } })
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), "wx", mode)
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(settingsDirectory)).toEqual(["settings.json"])
    expect(listClaudePermissionRules({ homeDir }).map((entry) => entry.rule)).toEqual(["Edit", "Bash"])
  })

  it("preserves the original settings and removes its temp file if promotion fails", () => {
    const { homeDir, settingsDirectory, file, settings } = fixture()
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("rename denied") })

    expect(() => deleteClaudePermissionRule({ homeDir, source: "userSettings", behavior: "allow", rule: "Read" })).toThrow("rename denied")

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(settings)
    expect(fs.readdirSync(settingsDirectory)).toEqual(["settings.json"])
  })

  it("does not overwrite or remove another file when exclusive creation fails", () => {
    const { homeDir, settingsDirectory, file, settings } = fixture()
    const open = fs.openSync.bind(fs)
    let collision: string | null = null
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      if (flags === "wx") {
        collision = String(target)
        fs.writeFileSync(target, "OTHER FILE")
      }
      return open(target, flags, mode)
    })

    expect(() => deleteClaudePermissionRule({ homeDir, source: "userSettings", behavior: "allow", rule: "Read" })).toThrow()

    expect(collision).not.toBeNull()
    expect(fs.readFileSync(collision!, "utf8")).toBe("OTHER FILE")
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(settings)
    expect(fs.readdirSync(settingsDirectory)).toHaveLength(2)
  })
})
