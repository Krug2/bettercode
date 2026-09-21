type Word = { value: string; end: number; quoted: boolean }
type Shell = "powershell" | "cmd" | "posix"

// This reader only locates argument boundaries for display. It never evaluates
// escapes, expansions or substitutions, and must not be used to execute a command.
function readWord(text: string, offset: number): Word | undefined {
  while (/\s/u.test(text[offset] ?? "") && offset < text.length) offset++
  if (offset === text.length) return
  const start = offset
  let quote = ""
  let quoted = false
  for (; offset < text.length; offset++) {
    const char = text[offset]!
    if (quote) {
      if ((char === "\\" || char === "`") && text[offset + 1] === quote)
        offset++
      else if (char === quote) quote = ""
    } else if (char === '"' || char === "'") {
      quote = char
      quoted = true
    } else if (/\s/u.test(char)) break
  }
  if (quote) return
  let value = text.slice(start, offset)
  if ((value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    value = value.slice(1, -1)
  }
  return { value, end: offset, quoted }
}

function identifyShell(executable: string): Shell | undefined {
  const name = executable
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "")
  switch (name) {
    case "pwsh":
    case "powershell":
      return "powershell"
    case "cmd":
      return "cmd"
    case "bash":
    case "sh":
    case "zsh":
      return "posix"
  }
}

function argumentRole(
  shell: Shell,
  value: string
): "command" | "value" | "option" | "stop" {
  const flag = value.toLowerCase()
  if (shell === "powershell") {
    if (flag === "-command") return "command"
    if (
      [
        "-executionpolicy",
        "-inputformat",
        "-outputformat",
        "-workingdirectory",
        "-windowstyle",
        "-version",
      ].includes(flag)
    )
      return "value"
    if (
      [
        "-noprofile",
        "-nologo",
        "-noninteractive",
        "-noexit",
        "-sta",
        "-mta",
      ].includes(flag)
    )
      return "option"
  } else if (shell === "cmd") {
    if (flag === "/c") return "command"
    if (/^\/(?:[sdqau]|[vef]:(?:on|off))$/.test(flag)) return "option"
  } else {
    if (flag === "-c" || flag === "-lc") return "command"
    if (["-o", "+o", "--rcfile", "--init-file"].includes(flag)) return "value"
    if (
      ["-l", "--login", "--noprofile", "--norc", "-e", "-u", "-x"].includes(
        flag
      )
    )
      return "option"
  }
  return "stop"
}

function quoteArgument(value: string): string {
  return /[\s"'`]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

export function displayCommand(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const args = value.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry.trim()] : []
    )
    if (!args.length) return
    const shell = identifyShell(args[0]!)
    if (shell) {
      for (let index = 1; index < args.length; index++) {
        const role = argumentRole(shell, args[index]!)
        if (role === "stop") break
        if (role === "value") index++
        if (role === "command") {
          // The provider already supplies argument boundaries. Re-quoting then
          // parsing here would add backslashes to the script's own quotes.
          const scriptArgs = args.slice(index + 1)
          if (scriptArgs.length === 1) return scriptArgs[0]
          if (scriptArgs.length > 1)
            return scriptArgs.map(quoteArgument).join(" ")
          break
        }
      }
    }
    return args.map(quoteArgument).join(" ")
  }
  if (typeof value !== "string" || !value.trim()) return
  const text = value.trim()
  const executable = readWord(text, 0)
  const shell = executable && identifyShell(executable.value)
  if (!shell || !executable) return text
  let offset = executable.end
  for (;;) {
    const word = readWord(text, offset)
    if (!word || word.quoted) return text
    offset = word.end
    const role = argumentRole(shell, word.value)
    if (role === "stop") return text
    if (role === "value") {
      const argument = readWord(text, offset)
      if (!argument) return text
      offset = argument.end
    }
    if (role === "command") {
      const script = text.slice(offset).trim()
      if (!script) return text
      const payload = readWord(script, 0)
      return payload?.quoted && payload.end === script.length
        ? payload.value
        : script
    }
  }
}
