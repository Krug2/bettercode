import path from "node:path"
import {
  readBoolean,
  readConfigValue,
  readStringRecord,
  readUnknownRecord,
} from "./formatters"
import {
  parseBooleanScalar,
  readBetterC0deProjectConfigs,
} from "./project-config"
import { readStringArray } from "./search"

export interface ProjectLspServerTemplate {
  id: string
  name: string
  enabled: boolean
  sourcePath: string
  command: string
  args: string[]
  env: Record<string, string>
  extensions: string[]
  initialization: Record<string, unknown>
  builtin: boolean
}

export async function listProjectLspServers(
  cwd: string
): Promise<ProjectLspServerTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectLspServerTemplate>()

  for (const { config, sourcePath } of await readBetterC0deProjectConfigs(
    root
  )) {
    const lspConfig = readConfigValue(config, "lsp")
    for (const server of projectLspServersFromConfig(lspConfig, sourcePath)) {
      byId.set(server.id, server)
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

type BuiltinLspServerDefinition = {
  id: string
  name: string
  extensions: string[]
}

const OPEN_CODE_BUILTIN_LSP_SERVERS: BuiltinLspServerDefinition[] = [
  builtinLsp("deno", [".ts", ".tsx", ".js", ".jsx", ".mjs"]),
  builtinLsp("typescript", [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
  ]),
  builtinLsp("vue", [".vue"]),
  builtinLsp("eslint", [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".vue",
  ]),
  builtinLsp("oxlint", [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".vue",
    ".astro",
    ".svelte",
  ]),
  builtinLsp("biome", [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ]),
  builtinLsp("gopls", [".go"]),
  builtinLsp("ruby-lsp", [".rb", ".rake", ".gemspec", ".ru"]),
  builtinLsp("ty", [".py", ".pyi"]),
  builtinLsp("pyright", [".py", ".pyi"]),
  builtinLsp("elixir-ls", [".ex", ".exs"]),
  builtinLsp("zls", [".zig", ".zon"]),
  builtinLsp("csharp", [".cs", ".csx"]),
  builtinLsp("razor", [".razor", ".cshtml"]),
  builtinLsp("fsharp", [".fs", ".fsi", ".fsx", ".fsscript"]),
  builtinLsp("sourcekit-lsp", [".swift", ".objc", "objcpp"]),
  builtinLsp("rust", [".rs"]),
  builtinLsp("clangd", [
    ".c",
    ".cpp",
    ".cc",
    ".cxx",
    ".c++",
    ".h",
    ".hpp",
    ".hh",
    ".hxx",
    ".h++",
  ]),
  builtinLsp("svelte", [".svelte"]),
  builtinLsp("astro", [".astro"]),
  builtinLsp("jdtls", [".java"]),
  builtinLsp("kotlin-ls", [".kt", ".kts"]),
  builtinLsp("yaml-ls", [".yaml", ".yml"]),
  builtinLsp("lua-ls", [".lua"]),
  builtinLsp("php intelephense", [".php"]),
  builtinLsp("prisma", [".prisma"]),
  builtinLsp("dart", [".dart"]),
  builtinLsp("ocaml-lsp", [".ml", ".mli"]),
  builtinLsp("bash", [".sh", ".bash", ".zsh", ".ksh"]),
  builtinLsp("terraform", [".tf", ".tfvars"]),
  builtinLsp("texlab", [".tex", ".bib"]),
  builtinLsp("dockerfile", [".dockerfile", "Dockerfile"]),
  builtinLsp("gleam", [".gleam"]),
  builtinLsp("clojure-lsp", [".clj", ".cljs", ".cljc", ".edn"]),
  builtinLsp("nixd", [".nix"]),
  builtinLsp("tinymist", [".typ", ".typc"]),
  builtinLsp("haskell-language-server", [".hs", ".lhs"]),
  builtinLsp("julials", [".jl"]),
]

const OPEN_CODE_BUILTIN_LSP_SERVER_BY_ID = new Map(
  OPEN_CODE_BUILTIN_LSP_SERVERS.map((server) => [server.id, server])
)

function builtinLsp(
  id: string,
  extensions: string[]
): BuiltinLspServerDefinition {
  return { id, name: id, extensions }
}

function projectLspServerFromBuiltin(
  server: BuiltinLspServerDefinition,
  sourcePath: string
): ProjectLspServerTemplate {
  return {
    id: server.id,
    name: server.name,
    enabled: true,
    sourcePath: `${sourcePath}.${server.id}`,
    command: "",
    args: [],
    env: {},
    extensions: server.extensions,
    initialization: {},
    builtin: true,
  }
}

function projectLspServersFromConfig(
  lspConfig: unknown,
  sourcePath: string
): ProjectLspServerTemplate[] {
  if (typeof lspConfig === "boolean") {
    if (lspConfig) {
      return activeBetterC0deBuiltinLspServers().map((server) =>
        projectLspServerFromBuiltin(server, `${sourcePath}#lsp`)
      )
    }
    return [
      {
        id: "builtins",
        name: "BetterC0de built-in LSP servers",
        enabled: lspConfig,
        sourcePath: `${sourcePath}#lsp`,
        command: "",
        args: [],
        env: {},
        extensions: [],
        initialization: {},
        builtin: true,
      },
    ]
  }

  if (!lspConfig || typeof lspConfig !== "object" || Array.isArray(lspConfig)) {
    return []
  }

  const byId = new Map<string, ProjectLspServerTemplate>()
  for (const server of activeBetterC0deBuiltinLspServers()) {
    byId.set(
      server.id,
      projectLspServerFromBuiltin(server, `${sourcePath}#lsp`)
    )
  }

  for (const [id, rawServer] of Object.entries(
    lspConfig as Record<string, unknown>
  )) {
    if (projectLspServerConfigDisabled(rawServer)) {
      byId.delete(id)
      continue
    }
    const server = projectLspServerFromConfig(id, rawServer, sourcePath)
    if (server) byId.set(server.id, server)
  }

  return Array.from(byId.values())
}

function activeBetterC0deBuiltinLspServers(): BuiltinLspServerDefinition[] {
  const experimentalTy =
    parseBooleanScalar(process.env.BetterC0de_EXPERIMENTAL_LSP_TY ?? "") ===
    true
  return OPEN_CODE_BUILTIN_LSP_SERVERS.filter((server) =>
    experimentalTy ? server.id !== "pyright" : server.id !== "ty"
  )
}

function projectLspServerConfigDisabled(rawServer: unknown): boolean {
  if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
    return false
  }
  return readBoolean((rawServer as Record<string, unknown>).disabled) === true
}

function projectLspServerFromConfig(
  id: string,
  rawServer: unknown,
  sourcePath: string
): ProjectLspServerTemplate | null {
  if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
    return null
  }

  const server = rawServer as Record<string, unknown>
  const command = readStringArray(server.command)
  const disabled = readBoolean(server.disabled) === true
  const builtin = OPEN_CODE_BUILTIN_LSP_SERVER_BY_ID.get(id)
  const extensions = readStringArray(server.extensions)
  return {
    id,
    name: id,
    enabled: !disabled,
    sourcePath: `${sourcePath}#lsp.${id}`,
    command: command[0] ?? "",
    args: command.slice(1),
    env: readStringRecord(server.env),
    extensions:
      extensions.length > 0 ? extensions : (builtin?.extensions ?? []),
    initialization: readUnknownRecord(server.initialization),
    builtin: command.length === 0,
  }
}
