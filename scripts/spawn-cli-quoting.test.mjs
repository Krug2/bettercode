import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import test from "node:test"

/**
 * `apps/shell/shared/spawn-cli.cjs` carries a verbatim copy of the cmd.exe
 * argument quoter in `apps/backend/src/security/windowsCommandLine.ts`
 * (the shell cannot import the compiled backend). This test is what keeps
 * the two in sync: the backend source is transpiled in-process and both
 * implementations must produce byte-identical tokens for every value below.
 * On Windows the shell helper is then driven through a real `.cmd` shim —
 * the case that shipped `a|b` as a pipe and `x>out.txt` as a redirect.
 */

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, "..")
const shell = require(path.join(root, "apps/shell/shared/spawn-cli.cjs"))

function loadBackendQuoter() {
  const ts = require("typescript")
  const source = fs.readFileSync(
    path.join(root, "apps/backend/src/security/windowsCommandLine.ts"),
    "utf8"
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} }
  new Function("module", "exports", "require", outputText)(
    module,
    module.exports,
    require
  )
  return module.exports
}

const backend = loadBackendQuoter()

/** Every shape the backend's own test exercises, plus the shim regressions. */
const VALUES = [
  "",
  "plain",
  "codex",
  "--version",
  "a b",
  "a b c",
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\x\\",
  "a&b",
  "a|b",
  "a>out.txt",
  "a<b",
  "a&&b",
  "x^y",
  "f(x)",
  "paren(s)",
  "bang!",
  "bang!value",
  "100%OS%x",
  "50% off",
  "%",
  "%%",
  "%OS%",
  "abc%",
  "% %",
  "a\\%b c",
  "a \\%b",
  "a\\\\b",
  'a\\"b',
  "a\\\\",
  'a\\\\\\"b',
  'trailing\\\\"',
  'quote"inside',
  'a"&b',
  'x"&y',
  'a" & calc.exe & "b',
  'C:\\path with space\\"odd".cmd',
  "--flag=a b",
  "ünïcödé",
  "a\tb",
]

/**
 * Expected tokens duplicated from `windowsCommandLine.test.ts`, so a change
 * that lands in both files at once still has to be a deliberate one.
 */
const EXPECTED_TOKENS = {
  "a&b": '"a&b"',
  "a|b": '"a|b"',
  "a>out.txt": '"a>out.txt"',
  "x^y": '"x^y"',
  "f(x)": '"f(x)"',
  "a b": '"a b"',
  "100%OS%x": "100^%OS^%x",
  "50% off": '50^%" off"',
  "%": "^%",
  "a\\%b c": 'a\\^%"b c"',
  "a \\%b": '"a \\\\"^%b',
  plain: "plain",
  "": '^"^"',
  'a"&b': '^"a\\^"^&b^"',
}

test("shell quoter is byte-identical to the backend quoter", () => {
  for (const value of VALUES) {
    assert.equal(
      shell.quoteWindowsCmdArg(value),
      backend.quoteWindowsCmdArg(value),
      `quoteWindowsCmdArg(${JSON.stringify(value)}) diverged from the backend`
    )
  }
  for (const command of [
    "codex",
    "C:\\tools\\codex.cmd",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\tools (x86)\\fmt.cmd",
  ]) {
    assert.equal(
      shell.quoteWindowsCmdPath(command),
      backend.quoteWindowsCmdPath(command)
    )
    const values = /\.exe$/i.test(command) && path.win32.isAbsolute(command)
      ? VALUES : VALUES.filter(value => !value.includes('"'))
    assert.deepEqual(
      shell.buildWindowsCmdArgs(command, values),
      backend.buildWindowsCmdArgs(command, values)
    )
  }
  assert.throws(() => shell.quoteWindowsCmdPath('C:\\odd"name.cmd'), /quote/)
})

test("shell and backend both reject unsafe batch arguments and executable expansions", () => {
  for (const implementation of [shell, backend]) {
    for (const command of ["codex", "relative.exe", "C:\\tools\\codex.cmd", "C:\\tools\\codex.bat"]) {
      assert.throws(() => implementation.buildWindowsCmdArgs(command, ['a" & echo injected']), /batch shim/)
    }
    for (const value of ["a\rvalue", "a\nvalue", "a\0value"]) {
      assert.throws(() => implementation.buildWindowsCmdArgs("C:\\tools\\node.exe", [value]), /CR, LF, or NUL/)
    }
    for (const command of ["C:\\%ROOT%\\tool.cmd", "C:\\!ROOT!\\tool.cmd"]) {
      assert.throws(() => implementation.buildWindowsCmdArgs(command, []), /expansion/)
    }
  }
})

test("shell quoter matches the documented token table", () => {
  for (const [value, token] of Object.entries(EXPECTED_TOKENS)) {
    assert.equal(shell.quoteWindowsCmdArg(value), token)
  }
  // Regression: the previous shell copy caret-escaped bare operators
  // (`a^&b`), which a `.cmd` shim's `%*` re-parse turned back into `a&b`.
  for (const value of ["a&b", "a|b", "a>out.txt", "x^y"]) {
    assert.equal(shell.quoteWindowsCmdArg(value), `"${value}"`)
  }
})

const isWindows = process.platform === "win32"

test(
  "shell helper delivers every argument intact through a real .cmd shim",
  { skip: isWindows ? false : "cmd.exe shim delivery only runs on win32" },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-shell-shim-"))
    try {
      const script = path.join(dir, "printargs.js")
      fs.writeFileSync(
        script,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n",
        "utf8"
      )
      const shim = path.join(dir, "shim.cmd")
      fs.writeFileSync(
        shim,
        '@ECHO off\r\nnode "%~dp0printargs.js" %*\r\n',
        "utf8"
      )
      const values = [
        "a&b",
        "a|b",
        "a>out.txt",
        "x^y",
        "100%OS%x",
        "a b",
        "50% off",
        "f(x)",
        "%OS%",
        "",
        "plain",
      ]
      const result = await shell.runCli(shim, values, {
        cwd: dir,
        timeoutMs: 30_000,
        env: { OS: "Windows_NT" },
      })
      assert.equal(result.code, 0, `shim exited ${result.code}: ${result.stderr}`)
      assert.deepEqual(JSON.parse(result.stdout.trim()), values)
      // `a>out.txt` must have reached the child as text, not as a redirect.
      assert.equal(fs.existsSync(path.join(dir, "out.txt")), false)

      await assert.rejects(async () => shell.runCli(shim, ['a" & echo injected>marker.txt & rem "'], {
        cwd: dir, timeoutMs: 30_000,
      }), /batch shim/)
      assert.equal(fs.existsSync(path.join(dir, "marker.txt")), false)

      // A direct absolute .exe bypasses cmd entirely and takes quotes too.
      const withQuotes = [...values, 'a"b', 'a"&b', 'say "hi" & calc']
      const direct = await shell.runCli(process.execPath, [script, ...withQuotes], {
        cwd: dir,
        timeoutMs: 30_000,
      })
      assert.equal(direct.code, 0, direct.stderr)
      assert.deepEqual(JSON.parse(direct.stdout.trim()), withQuotes)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
)
