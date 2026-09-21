import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildWindowsCmdArgs } from "../../security/windowsCommandLine"
import { sanitizedShellEnvironment } from "../../security/childEnvironment"
import {
  buildProjectFormatterSpawn,
  formatProjectFile,
  listProjectFormatters,
  WINDOWS_CMD_LINE_BUDGET_CHARS,
} from "./formatters"
import { runBoundedWorkspaceCommand } from "./processes"
import { __setWorkspaceMutationTestHookForTests } from "./files"

describe("buildProjectFormatterSpawn", () => {
  it("runs absolute .exe and non-Windows commands directly", () => {
    expect(
      buildProjectFormatterSpawn("C:\\tools\\fmt.exe", ["a b"], "win32")
    ).toEqual({
      command: "C:\\tools\\fmt.exe",
      args: ["a b"],
      windowsVerbatimArguments: false,
    })
    expect(buildProjectFormatterSpawn("prettier", ['a"b&c'], "linux")).toEqual({
      command: "prettier",
      args: ['a"b&c'],
      windowsVerbatimArguments: false,
    })
  })

  it("rejects literal quotes for Windows batch shims and escapes operators", () => {
    expect(() =>
      buildProjectFormatterSpawn(
        "prettier",
        ['weird "name" & calc.exe'],
        "win32"
      )
    ).toThrow(/absolute executable/)
    const value = "weird name & calc.exe"
    const spawn = buildProjectFormatterSpawn(
      "prettier",
      ["--write", value],
      "win32"
    )

    expect(spawn.windowsVerbatimArguments).toBe(true)
    expect(spawn.args).toEqual(
      buildWindowsCmdArgs("prettier", ["--write", value])
    )
    const line = spawn.args[3]!
    expect(line).toContain('"weird name & calc.exe"')
  })

  // cmd.exe reads the `/c` line only up to the first line break and refuses
  // lines over 8191 characters. Neither can be quoted around, so the spawn
  // is refused with a clear error instead of running a cut-off command.
  it("refuses a Windows command line that would exceed cmd's length limit", () => {
    const files = Array.from(
      { length: 200 },
      (_, index) =>
        `C:\\repo\\packages\\service ${index}\\src\\component-${index}.tsx`
    )
    const joined = files.join(" ").length
    expect(joined).toBeGreaterThan(WINDOWS_CMD_LINE_BUDGET_CHARS)

    let error: unknown
    try {
      buildProjectFormatterSpawn("prettier", ["--write", ...files], "win32")
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      statusCode: 400,
      code: "formatter_command_line_too_long",
    })
    expect((error as Error).message).toContain(
      String(WINDOWS_CMD_LINE_BUDGET_CHARS)
    )

    // The same list under the budget still spawns; only the total counts.
    const short = files.slice(0, 40)
    expect(short.join(" ").length).toBeLessThan(WINDOWS_CMD_LINE_BUDGET_CHARS)
    const spawn = buildProjectFormatterSpawn(
      "prettier",
      ["--write", ...short],
      "win32"
    )
    expect(spawn.args[3]!.length).toBeLessThanOrEqual(
      WINDOWS_CMD_LINE_BUDGET_CHARS
    )
    // Off the cmd.exe path there is no such limit to enforce.
    expect(
      buildProjectFormatterSpawn("prettier", ["--write", ...files], "linux")
        .args
    ).toHaveLength(files.length + 1)
  })

  it("refuses a Windows argument containing a line break", () => {
    for (const value of ["a\nb", "a\r\nb", "trailing\r"]) {
      let error: unknown
      try {
        buildProjectFormatterSpawn("prettier", ["--write", value], "win32")
      } catch (err) {
        error = err
      }
      expect(error).toMatchObject({
        statusCode: 400,
        code: "formatter_argument_line_break",
      })
    }
    // The command itself is checked too.
    expect(() =>
      buildProjectFormatterSpawn("pret\ntier", ["--write"], "win32")
    ).toThrow(/line break/)
    expect(
      buildProjectFormatterSpawn("prettier", ["a\nb"], "linux").args
    ).toEqual(["a\nb"])
  })
})

describe("formatter trust and staging cleanup", () => {
  let root: string
  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-fmt-lifecycle-"))
    )
    fs.mkdirSync(path.join(root, ".git"))
    vi.stubEnv("BetterC0de_TEST_HOME", path.join(root, "home"))
    vi.stubEnv("BETTERC0DE_TEST_MANAGED_CONFIG_DIR", path.join(root, "managed"))
  })
  afterEach(() => {
    __setWorkspaceMutationTestHookForTests(null)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function configureCustomFormatter() {
    fs.writeFileSync(path.join(root, "note.txt"), "original")
    fs.writeFileSync(
      path.join(root, "betterc0de.json"),
      JSON.stringify({
        formatter: {
          staged: {
            command: [process.execPath, "-e", "process.exit(0)", "$FILE"],
            extensions: [".txt"],
          },
        },
      })
    )
  }

  function configureAir() {
    const binDir = path.join(root, "node_modules", ".bin")
    fs.mkdirSync(binDir, { recursive: true })
    const marker = path.join(root, "executed")
    const script = path.join(root, "air.cjs")
    fs.writeFileSync(
      script,
      [
        "const fs = require('node:fs')",
        `fs.appendFileSync(${JSON.stringify(marker)}, 'executed\\n')`,
        "if (process.argv.includes('--help')) console.log('R language formatter')",
        "else fs.writeFileSync(process.argv.at(-1), 'formatted')",
      ].join("\n")
    )
    fs.writeFileSync(
      path.join(binDir, process.platform === "win32" ? "air.cmd" : "air"),
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`,
      { mode: 0o700 }
    )
    fs.writeFileSync(path.join(root, "betterc0de.json"), '{"formatter":true}')
    fs.writeFileSync(path.join(root, "note.R"), "original")
    return marker
  }

  it("lists repository formatter availability without executing its binary", async () => {
    const marker = configureAir()
    const formatters = await listProjectFormatters(root)
    expect(
      formatters.find((formatter) => formatter.id === "air")?.available
    ).toBe(true)
    expect(fs.existsSync(marker)).toBe(false)
  })

  it("requires explicit trust for builtin formatters resolved from the repository", async () => {
    const marker = configureAir()
    const input = { cwd: root, relativePath: "note.R", formatterId: "air" }
    expect((await formatProjectFile(input)).formatted).toBe(false)
    expect(fs.existsSync(marker)).toBe(false)
    expect(fs.readFileSync(path.join(root, "note.R"), "utf8")).toBe("original")
    expect(
      (await formatProjectFile({ ...input, allowWorkspaceCommands: true }))
        .formatted
    ).toBe(true)
    expect(fs.existsSync(marker)).toBe(true)
    expect(fs.readFileSync(path.join(root, "note.R"), "utf8")).toBe("formatted")
  })

  it("preserves a colliding candidate that exclusive creation did not own", async () => {
    configureCustomFormatter()
    const open = fsPromises.open.bind(fsPromises)
    let collision = ""
    vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
      const file = String(args[0])
      if (
        path.dirname(file) === root &&
        path.basename(file).startsWith(".betterc0de-format-")
      ) {
        collision = file
        fs.writeFileSync(file, "other writer", { flag: "wx" })
      }
      return await open(...args)
    })
    await expect(
      formatProjectFile({
        cwd: root,
        relativePath: "note.txt",
        formatterId: "staged",
        allowWorkspaceCommands: true,
      })
    ).rejects.toMatchObject({ code: "EEXIST" })
    expect(collision).not.toBe("")
    expect(fs.readFileSync(collision, "utf8")).toBe("other writer")
  })

  it("removes its candidate when final pre-spawn validation rejects", async () => {
    configureCustomFormatter()
    let candidate = ""
    __setWorkspaceMutationTestHookForTests(async (phase, paths) => {
      if (phase !== "format:before-spawn") return
      candidate = paths.source!
      throw new Error("validation rejected")
    })
    await expect(
      formatProjectFile({
        cwd: root,
        relativePath: "note.txt",
        formatterId: "staged",
        allowWorkspaceCommands: true,
      })
    ).rejects.toThrow("validation rejected")
    expect(candidate).not.toBe("")
    expect(fs.existsSync(candidate)).toBe(false)
    expect(fs.readFileSync(path.join(root, "note.txt"), "utf8")).toBe(
      "original"
    )
  })
})

describe("formatter argument delivery", () => {
  const tempDirs: string[] = []
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("delivers a quote-and-ampersand argument to a real child intact", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-fmt-argv-"))
    tempDirs.push(dir)
    const script = path.join(dir, "argv.cjs")
    fs.writeFileSync(
      script,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n",
      "utf8"
    )
    const value = 'weird "name" & echo pwned'
    const spawn = buildProjectFormatterSpawn(process.execPath, [
      script,
      value,
      "x y",
    ])
    const result = await runBoundedWorkspaceCommand({
      command: spawn.command,
      args: spawn.args,
      windowsVerbatimArguments: spawn.windowsVerbatimArguments,
      cwd: dir,
      env: sanitizedShellEnvironment(),
      timeoutMs: 20_000,
      outputLimitBytes: 64_000,
      label: "formatter-argv-test",
    })

    expect(result.exitCode).toBe(0)
    // argv[1] is the script itself; only the formatter arguments follow.
    expect(JSON.parse(result.stdout)).toEqual([value, "x y"])
  }, 30_000)
})
