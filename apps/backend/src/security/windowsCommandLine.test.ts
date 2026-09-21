import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildWindowsCmdArgs,
  quoteWindowsCmdArg,
  quoteWindowsCmdPath,
  requiresWindowsCmdWrapper,
  resolveComSpec,
} from "./windowsCommandLine"

/**
 * Decode a token the way cmd.exe does on a `/s /c "…"` verbatim line: an
 * unescaped `"` toggles a quoted region in which every character (carets
 * included) is literal; outside one, a caret makes the next character
 * literal. Report whether any *unescaped* operator survived outside a quoted
 * region — an unquoted `&`/`|`/`<`/`>` is a command separator, i.e. an
 * injection.
 */
function cmdLayer(token: string): { literal: string; unescapedOperator: boolean } {
  let literal = ""
  let unescapedOperator = false
  let inQuotes = false
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (inQuotes) {
      if (char === '"') inQuotes = false
      literal += char
      continue
    }
    if (char === "^") {
      literal += token[index + 1] ?? ""
      index += 1
      continue
    }
    if (char === '"') inQuotes = true
    if ("&|<>".includes(char)) unescapedOperator = true
    literal += char
  }
  return { literal, unescapedOperator }
}

/**
 * Parse one MSVCRT argv token back into its original value. An unescaped
 * `"` toggles quote mode anywhere in the token (`"a"%"b"` is `a%b`); a
 * backslash run only matters in front of a quote.
 */
function argvLayer(token: string): string {
  let out = ""
  let backslashes = 0
  for (const char of token) {
    if (char === "\\") {
      backslashes += 1
      continue
    }
    if (char === '"') {
      out += "\\".repeat(Math.floor(backslashes / 2))
      if (backslashes % 2 === 1) out += '"'
      backslashes = 0
      continue
    }
    out += "\\".repeat(backslashes)
    backslashes = 0
    out += char
  }
  return out + "\\".repeat(backslashes)
}

function roundTrip(value: string): { value: string; unescapedOperator: boolean } {
  const { literal, unescapedOperator } = cmdLayer(quoteWindowsCmdArg(value))
  return { value: argvLayer(literal), unescapedOperator }
}

describe("quoteWindowsCmdArg", () => {
  it("round-trips ordinary values, paths with spaces, and empty strings", () => {
    for (const value of [
      "codex",
      "--version",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "",
      "plain-value",
      "a b c",
    ]) {
      const result = roundTrip(value)
      expect(result.value).toBe(value)
      expect(result.unescapedOperator).toBe(false)
    }
  })

  // Regression: the previous implementation wrapped the value in quotes and
  // caret-escaped inside them. `^` is a literal inside a cmd quoted region, so
  // an embedded `"` closed the region and everything after it parsed
  // unquoted — `&`, `|` and `>` became live command separators.
  it("neutralizes a quote-then-operator breakout", () => {
    const hostile = 'a" & calc.exe & "b'
    const result = roundTrip(hostile)
    expect(result.unescapedOperator).toBe(false)
    expect(result.value).toBe(hostile)
  })

  it("leaves no unescaped operator for any metacharacter mix", () => {
    for (const value of [
      'x"&y',
      "a|b",
      "a>b",
      "a<b",
      "a&&b",
      'trailing\\\\"',
      'quote"inside',
      "paren(s)",
      "caret^value",
      "bang!value",
      'C:\\path with space\\"odd".cmd',
    ]) {
      const result = roundTrip(value)
      expect(result.unescapedOperator).toBe(false)
      expect(result.value).toBe(value)
    }
  })

  it("preserves backslash runs that precede a quote", () => {
    for (const value of ["a\\\\b", 'a\\"b', "a\\\\", 'a\\\\\\"b']) {
      expect(roundTrip(value).value).toBe(value)
    }
  })

  // Regression: a no-whitespace value with an operator was left bare and
  // caret-escaped (`a^&b`). cmd strips the carets before a `.cmd`/`.bat`
  // shim runs, and the batch's `%*` then re-parses `a&b` as two commands.
  // Real quotes survive `%*`; a `%` cannot sit inside them (it would expand)
  // so it is emitted between quoted regions as `^%`.
  it("wraps operator-bearing values in real quotes that survive a shim's %*", () => {
    expect(quoteWindowsCmdArg("a&b")).toBe('"a&b"')
    expect(quoteWindowsCmdArg("a|b")).toBe('"a|b"')
    expect(quoteWindowsCmdArg("a>out.txt")).toBe('"a>out.txt"')
    expect(quoteWindowsCmdArg("x^y")).toBe('"x^y"')
    expect(quoteWindowsCmdArg("f(x)")).toBe('"f(x)"')
    expect(quoteWindowsCmdArg("a b")).toBe('"a b"')
    expect(quoteWindowsCmdArg("100%OS%x")).toBe("100^%OS^%x")
    // Segments that need no quoting stay bare; `%` always sits outside.
    expect(quoteWindowsCmdArg("50% off")).toBe('50^%" off"')
    expect(quoteWindowsCmdArg("%")).toBe("^%")
    expect(quoteWindowsCmdArg("a\\%b c")).toBe('a\\^%"b c"')
    expect(quoteWindowsCmdArg("a \\%b")).toBe('"a \\\\"^%b')
    expect(quoteWindowsCmdArg("plain")).toBe("plain")
    expect(quoteWindowsCmdArg("")).toBe('^"^"')
    // A value with a quote keeps the fully caret-escaped form.
    expect(quoteWindowsCmdArg('a"&b')).toBe('^"a\\^"^&b^"')
    for (const value of ["a&b", "x^y", "100%OS%x", "50% off", "a\\%b c", "%"]) {
      const result = roundTrip(value)
      expect(result.unescapedOperator).toBe(false)
      expect(result.value).toBe(value)
    }
  })
})

/**
 * The real thing: cmd.exe, a real `.cmd` shim that forwards `%*` the way npm
 * shims do, and a child that reports its argv. Skipped (visibly) elsewhere.
 */
describe("quoteWindowsCmdArg through a real cmd.exe", () => {
  const tempDirs: string[] = []
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function createShim(): { shim: string; script: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-cmd-shim-"))
    tempDirs.push(dir)
    const script = path.join(dir, "printargs.js")
    fs.writeFileSync(
      script,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n",
      "utf8"
    )
    const shim = path.join(dir, "shim.cmd")
    fs.writeFileSync(shim, '@ECHO off\r\nnode "%~dp0printargs.js" %*\r\n', "utf8")
    return { shim, script }
  }

  function spawnThroughCmd(command: string, args: string[]): string[] {
    const result = spawnSync(resolveComSpec(), buildWindowsCmdArgs(command, args), {
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, OS: "Windows_NT" },
      timeout: 30_000,
    })
    if (result.status !== 0) {
      throw new Error(
        `cmd exited ${result.status}: ${result.stderr}${result.stdout}`
      )
    }
    return JSON.parse(result.stdout.trim()) as string[]
  }

  const values = [
    "a&b",
    "a|b",
    "a>out.txt",
    "x^y",
    "100%OS%x",
    "a b",
    "50% off",
    "f(x)",
    "bang!",
    "C:\\Program Files (x86)\\x\\",
    "%OS%",
    "",
    "plain",
  ]

  it.runIf(process.platform === "win32")(
    "delivers every argument intact through a .cmd shim",
    () => {
      const { shim } = createShim()
      expect(spawnThroughCmd(shim, values)).toEqual(values)
      // Batch reparsing cannot safely accept arbitrary embedded quotes.
      expect(() => spawnThroughCmd(shim, ['a"b'])).toThrow(/absolute executable/)
    },
    30_000
  )

  it.runIf(process.platform === "win32")(
    "rejects a quote/operator shim breakout before it creates a marker",
    () => {
      const { shim } = createShim()
      const marker = path.join(path.dirname(shim), "injected.txt")
      const payload = `a" & echo injected>"${marker}" & rem "`
      expect(() => spawnThroughCmd(shim, [payload])).toThrow(/absolute executable/)
      expect(fs.existsSync(marker)).toBe(false)
    }
  )

  it.runIf(process.platform === "win32")(
    "delivers every argument intact to a direct executable",
    () => {
      const { script } = createShim()
      const withQuotes = [...values, 'a"&b', 'say "hi" & calc']
      expect(spawnThroughCmd(process.execPath, [script, ...withQuotes])).toEqual(
        withQuotes
      )
    },
    30_000
  )
})

describe("buildWindowsCmdArgs", () => {
  it("emits the verbatim /d /s /c form with a single outer quote pair", () => {
    const args = buildWindowsCmdArgs("C:\\tools\\codex.cmd", [
      "app-server",
      "--flag",
    ])
    expect(args.slice(0, 3)).toEqual(["/d", "/s", "/c"])
    expect(args[3].startsWith('"')).toBe(true)
    expect(args[3].endsWith('"')).toBe(true)
  })

  // The command token is resolved by CMD, the argument tokens by the target
  // program — so they need different quoting. Caret-escaping the command's
  // quotes makes them literal characters, and cmd then looks for a file whose
  // name starts with `"` and reports "not recognized". Every CLI installed
  // under `C:\Program Files\…` or any temp dir with a space hits this.
  it("keeps the command path conventionally quoted, not caret-escaped", () => {
    const line = buildWindowsCmdArgs("C:\\Program Files\\Git\\bin\\bash.exe", [
      "-c",
      "echo hi",
    ])[3]
    expect(line).toContain('"C:\\Program Files\\Git\\bin\\bash.exe"')
    expect(line).not.toContain('^"C:\\Program Files')
  })

  it("still caret-escapes the arguments", () => {
    const command = "C:\\tools\\codex.exe"
    const line = buildWindowsCmdArgs(command, ['a" & calc.exe & "b'])[3]
    const inner = line.slice(1, -1)
    const argToken = inner.slice(command.length + 1)
    expect(cmdLayer(argToken).unescapedOperator).toBe(false)
  })

  it("refuses an executable path containing a quote", () => {
    expect(() => quoteWindowsCmdPath('C:\\bad"path\\x.exe')).toThrow(
      /must not contain a quote/i
    )
  })

  it("rejects unsafe batch arguments and command expansion across platforms", () => {
    for (const command of ["codex", "codex.exe", "C:\\tools\\codex.cmd", "C:\\tools\\codex.bat"]) {
      expect(() => buildWindowsCmdArgs(command, ['a"&echo marker'])).toThrow(/absolute executable/)
    }
    for (const value of ["a\rb", "a\nb", "a\0b"]) {
      expect(() => buildWindowsCmdArgs("C:\\tools\\codex.exe", [value])).toThrow(/CR, LF, or NUL/)
      expect(() => buildWindowsCmdArgs(value, [])).toThrow(/CR, LF, or NUL/)
    }
    for (const command of ["C:\\%TEMP%\\tool.exe", "C:\\!TEMP!\\tool.exe"]) {
      expect(() => buildWindowsCmdArgs(command, [])).toThrow(/expansion character/)
    }
  })
})

describe("requiresWindowsCmdWrapper", () => {
  it("wraps shims and bare names but not an absolute .exe", () => {
    expect(requiresWindowsCmdWrapper("C:\\tools\\codex.exe", "win32")).toBe(false)
    expect(requiresWindowsCmdWrapper("C:\\tools\\codex.cmd", "win32")).toBe(true)
    expect(requiresWindowsCmdWrapper("codex", "win32")).toBe(true)
    expect(requiresWindowsCmdWrapper("codex.exe", "win32")).toBe(true)
    expect(requiresWindowsCmdWrapper("/usr/bin/codex", "linux")).toBe(false)
  })
})
