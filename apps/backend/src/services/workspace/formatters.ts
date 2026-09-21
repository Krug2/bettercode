import { createHash, randomUUID } from "node:crypto"
import fsSync, { type Stats } from "node:fs"
import fs, { type FileHandle } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { logger } from "../../observability/logger"
import {
  isSafeShellEnvironmentOverrideKey,
  sanitizedShellEnvironment,
} from "../../security/childEnvironment"
import {
  buildWindowsCmdArgs,
  requiresWindowsCmdWrapper,
  resolveComSpec,
} from "../../security/windowsCommandLine"
import {
  assertMutableRelativePath,
  assertWorkspaceDirectoryUnchanged,
  captureWorkspaceTargetState,
  ensureWorkspaceDirectory,
  NO_FOLLOW_FLAG,
  removeOwnedTemporaryPath,
  resolveWorkspaceOperationPath,
  safeResolveInside,
  sameWorkspacePathIdentity,
  withSerializedWorkspaceMutation,
  workspaceMutationTestHook,
  workspacePathChanged,
  workspacePathIdentity,
  type WorkspaceDirectoryIdentity,
  type WorkspacePathIdentity,
} from "./files"
import {
  assertFormatterStagingDirectoriesUnchanged,
  errorMessage,
  reserveProjectFormatterOperation,
  runBoundedWorkspaceCommand,
  type ProjectFormatterOperationReservation,
} from "./processes"
import { readBetterC0deProjectConfigs } from "./project-config"
import { readStringArray } from "./search"

interface WorkspaceRegularFileSnapshot {
  readonly identity: WorkspacePathIdentity
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
}

interface StagedFormatterFile {
  readonly path: string
  readonly snapshot: WorkspaceRegularFileSnapshot
  readonly digest: string
  readonly parentChain: readonly WorkspaceDirectoryIdentity[]
}

interface FormatterStagingDestination {
  readonly path: string
  readonly parentChain: readonly WorkspaceDirectoryIdentity[]
}

interface FormatterFileBudget {
  readonly limitBytes: number
  readonly code:
    | "PROJECT_FORMATTER_INPUT_TOO_LARGE"
    | "PROJECT_FORMATTER_OUTPUT_TOO_LARGE"
  readonly label: "input" | "output"
}

function workspaceRegularFileSnapshot(
  stat: Stats
): WorkspaceRegularFileSnapshot {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error("formatter target must be a regular file"), {
      statusCode: 400,
    })
  }
  return {
    identity: workspacePathIdentity(stat),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function sameWorkspaceRegularFileSnapshot(
  left: WorkspaceRegularFileSnapshot,
  right: WorkspaceRegularFileSnapshot
): boolean {
  return (
    sameWorkspacePathIdentity(left.identity, right.identity) &&
    left.identity.kind === "file" &&
    right.identity.kind === "file" &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function assertFormatterFileWithinBudget(
  snapshot: WorkspaceRegularFileSnapshot,
  budget: FormatterFileBudget
): void {
  if (snapshot.size <= budget.limitBytes) return
  throw Object.assign(
    new Error(
      `Project formatter ${budget.label} exceeds ${budget.limitBytes} bytes.`
    ),
    {
      statusCode: 413,
      code: budget.code,
      actualBytes: snapshot.size,
      limitBytes: budget.limitBytes,
    }
  )
}

async function createFormatterStagingDestination(
  stagingRoot: string,
  stagingRootIdentity: WorkspaceDirectoryIdentity,
  lane: "source" | "candidate" | "accepted",
  workspaceRelativePath: string
): Promise<FormatterStagingDestination> {
  const relative = workspaceRelativePath.split(path.sep).filter(Boolean)
  if (
    relative.length === 0 ||
    path.isAbsolute(workspaceRelativePath) ||
    relative.some(
      (segment) => segment === "." || segment === ".." || segment.includes("\0")
    )
  ) {
    throw Object.assign(new Error("invalid formatter staging path"), {
      statusCode: 400,
    })
  }
  const fileName = relative.at(-1)!
  const laneRoot = path.join(stagingRoot, `${lane}-${randomUUID()}`)
  const destination = safeResolveInside(laneRoot, path.join(...relative))
  const parentChain: WorkspaceDirectoryIdentity[] = [stagingRootIdentity]
  let current = laneRoot
  await assertFormatterStagingDirectoriesUnchanged(parentChain)
  await fs.mkdir(current, { mode: 0o700 })
  let stat = await fs.lstat(current)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw workspacePathChanged("formatter staging lane is not a directory")
  }
  parentChain.push({
    ...workspacePathIdentity(stat),
    kind: "directory",
    path: current,
  })

  for (const segment of relative.slice(0, -1)) {
    current = path.join(current, segment)
    await fs.mkdir(current, { mode: 0o700 })
    stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw workspacePathChanged("formatter staging mirror is not a directory")
    }
    parentChain.push({
      ...workspacePathIdentity(stat),
      kind: "directory",
      path: current,
    })
  }
  await assertFormatterStagingDirectoriesUnchanged(parentChain)
  if (path.basename(destination) !== fileName) {
    throw new Error("formatter staging path did not preserve the file name")
  }
  return { path: destination, parentChain }
}

async function createWorkspaceFormatterCandidateDestination(
  root: string,
  rootIdentity: WorkspaceDirectoryIdentity,
  parentIdentity: WorkspaceDirectoryIdentity,
  originalFile: string
): Promise<FormatterStagingDestination> {
  await assertWorkspaceDirectoryUnchanged(root, rootIdentity)
  await assertWorkspaceDirectoryUnchanged(root, parentIdentity)
  const extension = path.extname(originalFile)
  const destination = path.join(
    parentIdentity.path,
    `.betterc0de-format-${randomUUID()}${extension}`
  )
  if (destination === originalFile) {
    throw new Error("formatter candidate path collided with its target")
  }
  const parentChain =
    rootIdentity.path === parentIdentity.path
      ? [rootIdentity]
      : [rootIdentity, parentIdentity]
  await assertFormatterStagingDirectoriesUnchanged(parentChain)
  return { path: destination, parentChain }
}

async function writeAllToFileHandle(
  handle: FileHandle,
  bytes: Buffer
): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null
    )
    if (written.bytesWritten <= 0) {
      throw new Error("formatter staging write made no progress")
    }
    offset += written.bytesWritten
  }
}

async function streamVerifiedRegularFile(
  sourcePath: string,
  expected: WorkspaceRegularFileSnapshot | undefined,
  onChunk: (chunk: Buffer) => Promise<void>,
  options: {
    readonly budget?: FormatterFileBudget
    readonly parentChain?: readonly WorkspaceDirectoryIdentity[]
  } = {}
): Promise<{ snapshot: WorkspaceRegularFileSnapshot; digest: string }> {
  if (options.parentChain) {
    await assertFormatterStagingDirectoriesUnchanged(options.parentChain)
  }
  const beforeStat = await fs.lstat(sourcePath)
  const before = workspaceRegularFileSnapshot(beforeStat)
  if (options.budget) {
    assertFormatterFileWithinBudget(before, options.budget)
  }
  if (expected && !sameWorkspaceRegularFileSnapshot(before, expected)) {
    throw workspacePathChanged("formatter source changed before it was opened")
  }

  const handle = await fs.open(
    sourcePath,
    fsSync.constants.O_RDONLY | NO_FOLLOW_FLAG
  )
  try {
    const opened = workspaceRegularFileSnapshot(await handle.stat())
    if (!sameWorkspaceRegularFileSnapshot(before, opened)) {
      throw workspacePathChanged("formatter source changed while it was opened")
    }

    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < opened.size) {
      const read = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, opened.size - position),
        position
      )
      if (read.bytesRead <= 0) {
        throw workspacePathChanged(
          "formatter source was truncated while it was copied"
        )
      }
      const chunk = buffer.subarray(0, read.bytesRead)
      hash.update(chunk)
      await onChunk(chunk)
      position += read.bytesRead
    }
    const trailing = await handle.read(Buffer.allocUnsafe(1), 0, 1, position)
    if (trailing.bytesRead !== 0) {
      throw workspacePathChanged("formatter source grew while it was copied")
    }

    const openedAfter = workspaceRegularFileSnapshot(await handle.stat())
    const pathAfter = workspaceRegularFileSnapshot(await fs.lstat(sourcePath))
    if (
      !sameWorkspaceRegularFileSnapshot(opened, openedAfter) ||
      !sameWorkspaceRegularFileSnapshot(opened, pathAfter)
    ) {
      throw workspacePathChanged("formatter source changed while it was copied")
    }
    if (options.parentChain) {
      await assertFormatterStagingDirectoriesUnchanged(options.parentChain)
    }
    return {
      snapshot: opened,
      digest: hash.digest("hex"),
    }
  } finally {
    await handle.close()
  }
}

async function createStagedFormatterFile(
  sourcePath: string,
  expectedSource: WorkspaceRegularFileSnapshot | undefined,
  sourceParentChain: readonly WorkspaceDirectoryIdentity[] | undefined,
  destination: FormatterStagingDestination,
  budget: FormatterFileBudget
): Promise<StagedFormatterFile> {
  if (sourceParentChain) {
    await assertFormatterStagingDirectoriesUnchanged(sourceParentChain)
  }
  const sourceBefore = workspaceRegularFileSnapshot(await fs.lstat(sourcePath))
  assertFormatterFileWithinBudget(sourceBefore, budget)
  if (
    expectedSource &&
    !sameWorkspaceRegularFileSnapshot(sourceBefore, expectedSource)
  ) {
    throw workspacePathChanged("formatter source changed before staging")
  }
  await assertFormatterStagingDirectoriesUnchanged(destination.parentChain)

  let destinationHandle: FileHandle | null = null
  let destinationIdentity: WorkspacePathIdentity | null = null
  try {
    destinationHandle = await fs.open(
      destination.path,
      fsSync.constants.O_CREAT |
        fsSync.constants.O_EXCL |
        fsSync.constants.O_WRONLY |
        NO_FOLLOW_FLAG,
      0o600
    )
    destinationIdentity = workspacePathIdentity(await destinationHandle.stat())
    const copied = await streamVerifiedRegularFile(
      sourcePath,
      sourceBefore,
      async (chunk) => writeAllToFileHandle(destinationHandle!, chunk),
      {
        budget,
        ...(sourceParentChain ? { parentChain: sourceParentChain } : {}),
      }
    )
    await destinationHandle.sync()
    const stagedSnapshot = workspaceRegularFileSnapshot(
      await destinationHandle.stat()
    )
    await destinationHandle.close()
    destinationHandle = null

    const pathSnapshot = workspaceRegularFileSnapshot(
      await fs.lstat(destination.path)
    )
    if (!sameWorkspaceRegularFileSnapshot(stagedSnapshot, pathSnapshot)) {
      throw workspacePathChanged(
        "formatter staging file changed after it was written"
      )
    }
    await assertFormatterStagingDirectoriesUnchanged(destination.parentChain)
    return {
      path: destination.path,
      snapshot: stagedSnapshot,
      digest: copied.digest,
      parentChain: destination.parentChain,
    }
  } catch (error) {
    await destinationHandle?.close().catch(() => undefined)
    if (destinationIdentity) {
      await removeStagedFormatterFile(destination, destinationIdentity)
    }
    throw error
  }
}

async function removeStagedFormatterFile(
  staged: Pick<StagedFormatterFile, "path" | "parentChain">,
  expectedIdentity?: WorkspacePathIdentity
): Promise<void> {
  try {
    await assertFormatterStagingDirectoriesUnchanged(staged.parentChain)
    const stat = await fs.lstat(staged.path)
    if (
      expectedIdentity &&
      !sameWorkspacePathIdentity(expectedIdentity, workspacePathIdentity(stat))
    )
      return
    if (stat.isFile() || stat.isSymbolicLink()) {
      await fs.rm(staged.path, { force: true })
    }
  } catch {
    // Never follow a formatter-replaced parent during best-effort cleanup.
  }
}

async function assertStagedFormatterFileIdentityUnchanged(
  staged: StagedFormatterFile
): Promise<void> {
  await assertFormatterStagingDirectoriesUnchanged(staged.parentChain)
  const stat = await fs.lstat(staged.path)
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !sameWorkspacePathIdentity(
      staged.snapshot.identity,
      workspacePathIdentity(stat)
    )
  ) {
    throw workspacePathChanged(
      "formatter staging file identity changed during execution"
    )
  }
}

async function removePrivateFormatterStagingRoot(
  stagingRoot: string,
  expected: WorkspaceDirectoryIdentity
): Promise<void> {
  try {
    const stat = await fs.lstat(stagingRoot)
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !sameWorkspacePathIdentity(expected, workspacePathIdentity(stat))
    ) {
      return
    }
    await fs.rm(stagingRoot, { recursive: true, force: true })
  } catch {
    // An identity change must not redirect recursive cleanup.
  }
}

async function assertWorkspaceRegularFileUnchanged(
  target: string,
  expected: WorkspaceRegularFileSnapshot,
  expectedDigest?: string
): Promise<void> {
  const current = workspaceRegularFileSnapshot(await fs.lstat(target))
  if (!sameWorkspaceRegularFileSnapshot(current, expected)) {
    throw workspacePathChanged("formatter target changed before commit")
  }
  if (expectedDigest) {
    const verified = await streamVerifiedRegularFile(
      target,
      expected,
      async () => undefined
    )
    if (verified.digest !== expectedDigest) {
      throw workspacePathChanged(
        "formatter target contents changed before commit"
      )
    }
  }
}

export interface ProjectFormatterTemplate {
  id: string
  name: string
  enabled: boolean
  available?: boolean
  sourcePath: string
  command: string
  args: string[]
  env: Record<string, string>
  extensions: string[]
  builtin: boolean
  /**
   * True when the formatter came from config inside the opened repository.
   * A non-builtin formatter names a command BetterC0de spawns, so a
   * workspace-controlled one needs explicit trust — see `formatProjectFile`.
   */
  workspaceControlled?: boolean
}

export interface ProjectFormatRunTemplate {
  id: string
  name: string
  sourcePath: string
  command: string
  args: string[]
  success: boolean
  exitCode: number | null
  signal?: NodeJS.Signals | string | null
  stdout: string
  stderr: string
  timedOut: boolean
  skippedReason?: string
}

export interface ProjectFormatFileResult {
  file: string
  formatted: boolean
  results: ProjectFormatRunTemplate[]
  skippedReason?: string
}

export const PROJECT_COMMAND_MAX_BYTES = 256 * 1024

export async function listProjectFormatters(
  cwd: string
): Promise<ProjectFormatterTemplate[]> {
  const root = path.resolve(cwd)
  const byId = new Map<string, ProjectFormatterTemplate>()

  for (const {
    config,
    sourcePath,
    workspaceControlled,
  } of await readBetterC0deProjectConfigs(root)) {
    const formatterConfig = readConfigValue(config, "formatter")
    for (const formatter of projectFormattersFromConfig(
      formatterConfig,
      sourcePath
    )) {
      byId.set(formatter.id, { ...formatter, workspaceControlled })
    }
  }

  const annotated = await Promise.all(
    Array.from(byId.values()).map((formatter) =>
      annotateProjectFormatterAvailability(root, formatter)
    )
  )
  return annotated.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { sensitivity: "base" })
  )
}

export async function formatProjectFile(input: {
  cwd: string
  relativePath: string
  formatterId?: string
  /**
   * Whether the repository is explicitly trusted to execute formatters.
   * Builtins may resolve repository binaries or load repository plugins, so
   * they need the same trust as workspace-configured commands.
   */
  allowWorkspaceCommands?: boolean
}): Promise<ProjectFormatFileResult> {
  const requestedRoot = path.resolve(input.cwd)
  assertMutableRelativePath(input.relativePath)
  const resolved = await resolveWorkspaceOperationPath(
    requestedRoot,
    input.relativePath
  ).catch((error) => {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw Object.assign(new Error("file not found"), { statusCode: 404 })
    }
    throw error
  })
  const root = resolved.root
  const file = resolved.target
  let stat: Stats
  try {
    stat = await fs.lstat(file)
  } catch {
    throw Object.assign(new Error("file not found"), { statusCode: 404 })
  }
  if (!stat.isFile()) {
    throw Object.assign(new Error("formatter target must be a file"), {
      statusCode: 400,
    })
  }
  const expectedTarget = workspaceRegularFileSnapshot(stat)
  const rootIdentity = await ensureWorkspaceDirectory(root, root)
  const parentIdentity = await ensureWorkspaceDirectory(
    root,
    path.dirname(file)
  )

  const formatters = (await listProjectFormatters(root)).filter((formatter) => {
    if (input.allowWorkspaceCommands === true) return true
    if (!formatter.workspaceControlled && !formatter.builtin) return true
    logger.warn(
      { sourcePath: formatter.sourcePath },
      "ignoring formatter command because the workspace is not explicitly trusted"
    )
    return false
  })
  const candidates = selectProjectFormattersForFile(
    formatters,
    file,
    input.formatterId
  )
  if (candidates.length === 0) {
    const skippedReason = input.formatterId?.trim()
      ? `No enabled BetterC0de formatter named "${input.formatterId}" matches ${path.basename(file)}.`
      : `No enabled BetterC0de formatter matches ${path.basename(file)}.`
    return {
      file: path.relative(root, file) || path.basename(file),
      formatted: false,
      results: [],
      skippedReason,
    }
  }

  assertFormatterFileWithinBudget(
    expectedTarget,
    PROJECT_FORMATTER_INPUT_BUDGET
  )
  let operation: ProjectFormatterOperationReservation
  try {
    operation = await reserveProjectFormatterOperation(root)
  } catch (error) {
    if (
      (error as { readonly code?: unknown }).code !==
      "PROJECT_FORMATTER_SHUTTING_DOWN"
    ) {
      throw error
    }
    return {
      file: path.relative(root, file) || path.basename(file),
      formatted: false,
      results: candidates.map((formatter) => {
        const reported = buildProjectFormatterCommand(formatter, file)
        return {
          id: formatter.id,
          name: formatter.name,
          sourcePath: formatter.sourcePath,
          command: reported.command,
          args: reported.args,
          success: false,
          exitCode: null,
          stdout: "",
          stderr: errorMessage(error),
          timedOut: false,
        }
      }),
    }
  }
  let stagingRoot: string | null = null
  let stagingRootIdentity: WorkspaceDirectoryIdentity | null = null
  const results: ProjectFormatRunTemplate[] = []

  try {
    stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "betterc0de-format-"))
    const stagingRootStat = await fs.lstat(stagingRoot)
    if (stagingRootStat.isSymbolicLink() || !stagingRootStat.isDirectory()) {
      throw workspacePathChanged(
        "private formatter staging root is not a directory"
      )
    }
    stagingRootIdentity = {
      ...workspacePathIdentity(stagingRootStat),
      kind: "directory",
      path: stagingRoot,
    }
    const workspaceRelativePath =
      path.relative(root, file) || path.basename(file)
    let working = await createStagedFormatterFile(
      file,
      expectedTarget,
      undefined,
      await createFormatterStagingDestination(
        stagingRoot,
        stagingRootIdentity,
        "source",
        workspaceRelativePath
      ),
      PROJECT_FORMATTER_INPUT_BUDGET
    )
    const originalDigest = working.digest

    for (const formatter of candidates) {
      const revalidated = await resolveWorkspaceOperationPath(
        root,
        input.relativePath
      )
      if (revalidated.root !== root || revalidated.target !== file) {
        throw workspacePathChanged("formatter target changed during validation")
      }
      await assertWorkspaceRegularFileUnchanged(file, expectedTarget)

      const resolvedFormatter = await resolveProjectFormatterExecutable(
        root,
        formatter,
        file
      )
      if (!resolvedFormatter.command) {
        results.push({
          id: formatter.id,
          name: formatter.name,
          sourcePath: formatter.sourcePath,
          command: "",
          args: [],
          success: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          skippedReason:
            "Formatter has no executable command in project config. Add `command` or use a BetterC0de runtime that manages built-ins.",
        })
        continue
      }

      const candidateDestination =
        await createWorkspaceFormatterCandidateDestination(
          root,
          rootIdentity,
          parentIdentity,
          file
        )
      const candidate = await createStagedFormatterFile(
        working.path,
        working.snapshot,
        working.parentChain,
        candidateDestination,
        PROJECT_FORMATTER_OUTPUT_BUDGET
      )
      try {
        let result = await runProjectFormatter(
          root,
          resolvedFormatter,
          candidate,
          file,
          input.relativePath,
          expectedTarget
        )

        if (result.success) {
          try {
            await assertStagedFormatterFileIdentityUnchanged(candidate)
            const accepted = await createStagedFormatterFile(
              candidate.path,
              undefined,
              candidate.parentChain,
              await createFormatterStagingDestination(
                stagingRoot,
                stagingRootIdentity,
                "accepted",
                workspaceRelativePath
              ),
              PROJECT_FORMATTER_OUTPUT_BUDGET
            )
            await removeStagedFormatterFile(working)
            working = accepted
          } catch (error) {
            const errorCode =
              error && typeof error === "object" && "code" in error
                ? (error as { readonly code?: unknown }).code
                : undefined
            const publicError =
              errorCode === "PROJECT_FORMATTER_OUTPUT_TOO_LARGE"
                ? `Formatter file output exceeded ${PROJECT_FORMATTER_ACCEPTED_OUTPUT_LIMIT_BYTES} bytes.`
                : "Formatter output could not be accepted safely."
            result = {
              ...result,
              success: false,
              stderr: [result.stderr, publicError].filter(Boolean).join("\n"),
            }
          }
        }
        results.push(result)
      } finally {
        await removeStagedFormatterFile(candidate)
      }
    }

    if (results.some((result) => result.success)) {
      await commitStagedFormatterFile({
        root,
        relativePath: input.relativePath,
        target: file,
        rootIdentity,
        parentIdentity,
        expectedTarget,
        expectedDigest: originalDigest,
        staged: working,
      })
    }

    return {
      file: path.relative(root, file) || path.basename(file),
      formatted: results.some((result) => result.success),
      results,
      ...(results.every((result) => result.skippedReason)
        ? { skippedReason: "No executable formatter command was available." }
        : {}),
    }
  } finally {
    try {
      if (stagingRoot && stagingRootIdentity) {
        await removePrivateFormatterStagingRoot(
          stagingRoot,
          stagingRootIdentity
        )
      }
    } finally {
      operation.release()
    }
  }
}

const PROJECT_FORMATTER_TIMEOUT_MS = 120_000

const PROJECT_FORMATTER_OUTPUT_LIMIT = 64_000

const PROJECT_FORMATTER_INPUT_LIMIT_BYTES = 16 * 1024 * 1024

const PROJECT_FORMATTER_ACCEPTED_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024

const PROJECT_FORMATTER_INPUT_BUDGET: FormatterFileBudget = {
  limitBytes: PROJECT_FORMATTER_INPUT_LIMIT_BYTES,
  code: "PROJECT_FORMATTER_INPUT_TOO_LARGE",
  label: "input",
}

const PROJECT_FORMATTER_OUTPUT_BUDGET: FormatterFileBudget = {
  limitBytes: PROJECT_FORMATTER_ACCEPTED_OUTPUT_LIMIT_BYTES,
  code: "PROJECT_FORMATTER_OUTPUT_TOO_LARGE",
  label: "output",
}

type BuiltinFormatterDefinition = {
  id: string
  name: string
  extensions: string[]
  env?: Record<string, string>
  resolve: (
    workspaceRoot: string,
    filePath: string,
    options?: { readonly allowProcessProbe: boolean }
  ) => string[] | null | Promise<string[] | null>
}

const OPEN_CODE_PRETTIER_EXTENSIONS = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".md",
  ".mdx",
  ".graphql",
  ".gql",
]

const OPEN_CODE_BUILTIN_FORMATTERS: BuiltinFormatterDefinition[] = [
  builtinFormatter("gofmt", [".go"], "gofmt", ["-w", "$FILE"]),
  builtinFormatter(
    "mix",
    [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
    "mix",
    ["format", "$FILE"]
  ),
  builtinFormatter(
    "prettier",
    OPEN_CODE_PRETTIER_EXTENSIONS,
    "prettier",
    ["--write", "$FILE"],
    { BUN_BE_BUN: "1" },
    (workspaceRoot, filePath) =>
      packageJsonHasDependency(workspaceRoot, filePath, "prettier")
  ),
  builtinFormatter(
    "oxfmt",
    [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
    "oxfmt",
    ["$FILE"],
    { BUN_BE_BUN: "1" },
    (workspaceRoot, filePath) =>
      isBetterC0deExperimentalFlagEnabled("BetterC0de_EXPERIMENTAL_OXFMT") &&
      packageJsonHasDependency(workspaceRoot, filePath, "oxfmt")
  ),
  builtinFormatter(
    "biome",
    OPEN_CODE_PRETTIER_EXTENSIONS,
    "biome",
    ["format", "--write", "$FILE"],
    { BUN_BE_BUN: "1" },
    (workspaceRoot, filePath) =>
      findUpFileSync("biome.json", path.dirname(filePath), workspaceRoot)
        .length > 0 ||
      findUpFileSync("biome.jsonc", path.dirname(filePath), workspaceRoot)
        .length > 0
  ),
  builtinFormatter("zig", [".zig", ".zon"], "zig", ["fmt", "$FILE"]),
  builtinFormatter(
    "clang-format",
    [
      ".c",
      ".cc",
      ".cpp",
      ".cxx",
      ".c++",
      ".h",
      ".hh",
      ".hpp",
      ".hxx",
      ".h++",
      ".ino",
      ".C",
      ".H",
    ],
    "clang-format",
    ["-i", "$FILE"],
    undefined,
    (workspaceRoot, filePath) =>
      findUpFileSync(".clang-format", path.dirname(filePath), workspaceRoot)
        .length > 0
  ),
  builtinFormatter("ktlint", [".kt", ".kts"], "ktlint", ["-F", "$FILE"]),
  {
    id: "ruff",
    name: "ruff",
    extensions: [".py", ".pyi"],
    resolve: resolveRuffFormatterCommand,
  },
  {
    id: "air",
    name: "air",
    extensions: [".R"],
    async resolve(workspaceRoot, _filePath, options) {
      const bin = findExecutableOnPath("air", workspaceRoot)
      if (!bin) return null
      // Listing availability is a read operation. Defer executable identity
      // probing until an explicitly trusted formatter invocation.
      if (
        options?.allowProcessProbe !== false &&
        !(await isAirFormatterBinary(bin))
      ) {
        return null
      }
      return [bin, "format", "$FILE"]
    },
  },
  {
    id: "uv",
    name: "uv",
    extensions: [".py", ".pyi"],
    resolve(workspaceRoot, filePath) {
      if (resolveRuffFormatterCommand(workspaceRoot, filePath)) return null
      const uv = findExecutableOnPath("uv", workspaceRoot)
      if (!uv) return null
      // Capability detection used to synchronously execute `uv --help` on the
      // request thread. Resolve by presence and let the already-bounded actual
      // formatter invocation report unsupported subcommands.
      return [uv, "format", "--", "$FILE"]
    },
  },
  builtinFormatter("rubocop", [".rb", ".rake", ".gemspec", ".ru"], "rubocop", [
    "--autocorrect",
    "$FILE",
  ]),
  builtinFormatter(
    "standardrb",
    [".rb", ".rake", ".gemspec", ".ru"],
    "standardrb",
    ["--fix", "$FILE"]
  ),
  builtinFormatter("htmlbeautifier", [".erb", ".html.erb"], "htmlbeautifier", [
    "$FILE",
  ]),
  builtinFormatter("dart", [".dart"], "dart", ["format", "$FILE"]),
  builtinFormatter("ocamlformat", [".ml", ".mli"], "ocamlformat", [
    "-i",
    "$FILE",
  ]),
  builtinFormatter("terraform", [".tf", ".tfvars"], "terraform", [
    "fmt",
    "$FILE",
  ]),
  builtinFormatter("latexindent", [".tex"], "latexindent", [
    "-w",
    "-s",
    "$FILE",
  ]),
  builtinFormatter("gleam", [".gleam"], "gleam", ["format", "$FILE"]),
  builtinFormatter("shfmt", [".sh", ".bash"], "shfmt", ["-w", "$FILE"]),
  builtinFormatter("nixfmt", [".nix"], "nixfmt", ["$FILE"]),
  builtinFormatter("rustfmt", [".rs"], "rustfmt", ["$FILE"]),
  {
    id: "pint",
    name: "pint",
    extensions: [".php"],
    resolve(workspaceRoot, filePath) {
      if (!composerJsonHasDependency(workspaceRoot, filePath, "laravel/pint")) {
        return null
      }
      const local = path.join(workspaceRoot, "vendor", "bin", "pint")
      if (isExecutableFile(local)) return [local, "$FILE"]
      return ["./vendor/bin/pint", "$FILE"]
    },
  },
  builtinFormatter("ormolu", [".hs"], "ormolu", ["-i", "$FILE"]),
  builtinFormatter("cljfmt", [".clj", ".cljs", ".cljc", ".edn"], "cljfmt", [
    "fix",
    "--quiet",
    "$FILE",
  ]),
  builtinFormatter("dfmt", [".d"], "dfmt", ["-i", "$FILE"]),
]

const OPEN_CODE_BUILTIN_FORMATTER_BY_ID = new Map(
  OPEN_CODE_BUILTIN_FORMATTERS.flatMap((formatter) => [
    [formatter.id, formatter],
    [formatter.name, formatter],
  ])
)

function builtinFormatter(
  id: string,
  extensions: string[],
  binName: string,
  args: string[],
  env?: Record<string, string>,
  isEnabled?: (
    workspaceRoot: string,
    filePath: string,
    binPath: string
  ) => boolean | Promise<boolean>
): BuiltinFormatterDefinition {
  return {
    id,
    name: id,
    extensions,
    ...(env ? { env } : {}),
    resolve(workspaceRoot, filePath) {
      const bin = findExecutableOnPath(binName, workspaceRoot)
      if (!bin) return null
      const enabled = isEnabled?.(workspaceRoot, filePath, bin)
      return enabled instanceof Promise
        ? enabled.then((allowed) => (allowed ? [bin, ...args] : null))
        : enabled === false
          ? null
          : [bin, ...args]
    },
  }
}

function selectProjectFormattersForFile(
  formatters: readonly ProjectFormatterTemplate[],
  file: string,
  formatterId?: string
): ProjectFormatterTemplate[] {
  const requested = formatterId?.trim().toLowerCase()
  const extension = path.extname(file).toLowerCase()
  return formatters.filter((formatter) => {
    if (!formatter.enabled) return false
    if (
      requested &&
      formatter.id.toLowerCase() !== requested &&
      formatter.name.toLowerCase() !== requested
    ) {
      return false
    }
    if (formatter.extensions.length === 0) return Boolean(requested)
    return formatter.extensions.some(
      (candidate) => candidate.toLowerCase() === extension
    )
  })
}

async function resolveProjectFormatterExecutable(
  workspaceRoot: string,
  formatter: ProjectFormatterTemplate,
  file: string,
  allowProcessProbe = true
): Promise<ProjectFormatterTemplate> {
  if (formatter.command || !formatter.builtin) return formatter
  const builtin =
    OPEN_CODE_BUILTIN_FORMATTER_BY_ID.get(formatter.id) ??
    OPEN_CODE_BUILTIN_FORMATTER_BY_ID.get(formatter.name)
  if (!builtin) return formatter
  if (
    builtin.extensions.length > 0 &&
    !builtin.extensions.some(
      (extension) =>
        extension.toLowerCase() === path.extname(file).toLowerCase()
    )
  ) {
    return formatter
  }
  const command = await builtin.resolve(workspaceRoot, file, {
    allowProcessProbe,
  })
  if (!command?.[0]) return formatter
  return {
    ...formatter,
    command: command[0],
    args: command.slice(1),
    env: { ...(builtin.env ?? {}), ...formatter.env },
    extensions:
      formatter.extensions.length > 0
        ? formatter.extensions
        : builtin.extensions,
  }
}

async function annotateProjectFormatterAvailability(
  workspaceRoot: string,
  formatter: ProjectFormatterTemplate
): Promise<ProjectFormatterTemplate> {
  if (!formatter.enabled) return { ...formatter, available: false }
  if (formatter.command || !formatter.builtin) {
    return { ...formatter, available: true }
  }
  const probeFile = path.join(
    workspaceRoot,
    `.betterc0de-formatter-status${formatter.extensions[0] ?? ""}`
  )
  const resolved = await resolveProjectFormatterExecutable(
    workspaceRoot,
    formatter,
    probeFile,
    false
  )
  return { ...formatter, available: Boolean(resolved.command) }
}

async function commitStagedFormatterFile(input: {
  root: string
  relativePath: string
  target: string
  rootIdentity: WorkspaceDirectoryIdentity
  parentIdentity: WorkspaceDirectoryIdentity
  expectedTarget: WorkspaceRegularFileSnapshot
  expectedDigest: string
  staged: StagedFormatterFile
}): Promise<void> {
  await withSerializedWorkspaceMutation(input.root, async () => {
    await workspaceMutationTestHook?.("format:before-commit", {
      root: input.root,
      source: input.staged.path,
      target: input.target,
    })
    await assertWorkspaceDirectoryUnchanged(input.root, input.rootIdentity)
    await assertWorkspaceDirectoryUnchanged(input.root, input.parentIdentity)
    const resolved = await resolveWorkspaceOperationPath(
      input.root,
      input.relativePath
    )
    if (resolved.root !== input.root || resolved.target !== input.target) {
      throw workspacePathChanged("formatter target changed before commit")
    }
    await assertWorkspaceRegularFileUnchanged(
      input.target,
      input.expectedTarget,
      input.expectedDigest
    )
    await assertFormatterStagingDirectoriesUnchanged(input.staged.parentChain)

    const temporaryPath = path.join(
      input.parentIdentity.path,
      `.betterc0de-format-${process.pid}-${randomUUID()}.tmp`
    )
    let temporaryIdentity: WorkspacePathIdentity | null = null
    let committed = false
    let destination: FileHandle | null = null

    try {
      destination = await fs.open(
        temporaryPath,
        fsSync.constants.O_CREAT |
          fsSync.constants.O_EXCL |
          fsSync.constants.O_WRONLY |
          NO_FOLLOW_FLAG,
        input.expectedTarget.identity.mode & 0o777
      )
      temporaryIdentity = workspacePathIdentity(await destination.stat())
      const copied = await streamVerifiedRegularFile(
        input.staged.path,
        input.staged.snapshot,
        async (chunk) => writeAllToFileHandle(destination!, chunk),
        {
          budget: PROJECT_FORMATTER_OUTPUT_BUDGET,
          parentChain: input.staged.parentChain,
        }
      )
      if (copied.digest !== input.staged.digest) {
        throw workspacePathChanged(
          "formatter staging contents changed before commit"
        )
      }
      await destination.chmod(input.expectedTarget.identity.mode & 0o777)
      await destination.sync()
      const completed = workspaceRegularFileSnapshot(await destination.stat())
      if (
        !temporaryIdentity ||
        !sameWorkspacePathIdentity(temporaryIdentity, completed.identity)
      ) {
        throw workspacePathChanged(
          "temporary formatter output changed during commit"
        )
      }
      temporaryIdentity = completed.identity
      await destination.close()
      destination = null

      const temporaryState = await captureWorkspaceTargetState(temporaryPath)
      if (
        temporaryState.kind !== "present" ||
        temporaryState.identity.kind !== "file" ||
        !sameWorkspacePathIdentity(temporaryState.identity, temporaryIdentity)
      ) {
        throw workspacePathChanged(
          "temporary formatter output changed before commit"
        )
      }

      // These are deliberately the final operations before the atomic rename.
      // The formatter sees only its UUID sibling, never the target or commit path.
      await assertWorkspaceDirectoryUnchanged(input.root, input.rootIdentity)
      await assertWorkspaceDirectoryUnchanged(input.root, input.parentIdentity)
      const finalResolved = await resolveWorkspaceOperationPath(
        input.root,
        input.relativePath
      )
      if (
        finalResolved.root !== input.root ||
        finalResolved.target !== input.target
      ) {
        throw workspacePathChanged("formatter target changed before commit")
      }
      await assertWorkspaceRegularFileUnchanged(
        input.target,
        input.expectedTarget,
        input.expectedDigest
      )

      await fs.rename(temporaryPath, input.target)
      committed = true

      const committedResolved = await resolveWorkspaceOperationPath(
        input.root,
        input.relativePath
      )
      const committedState = await captureWorkspaceTargetState(input.target)
      if (
        committedResolved.root !== input.root ||
        committedResolved.target !== input.target ||
        committedState.kind !== "present" ||
        committedState.identity.kind !== "file" ||
        !sameWorkspacePathIdentity(committedState.identity, temporaryIdentity)
      ) {
        throw workspacePathChanged("formatter target changed during commit")
      }
    } finally {
      await destination?.close().catch(() => undefined)
      if (!committed) {
        await removeOwnedTemporaryPath(
          input.root,
          input.parentIdentity,
          temporaryPath,
          temporaryIdentity
        )
      }
    }
  })
}

async function runProjectFormatter(
  cwd: string,
  formatter: ProjectFormatterTemplate,
  staged: StagedFormatterFile,
  originalFile: string,
  relativePath: string,
  expectedTarget: WorkspaceRegularFileSnapshot
): Promise<ProjectFormatRunTemplate> {
  const { command, args } = buildProjectFormatterCommand(formatter, staged.path)
  const reported = buildProjectFormatterCommand(formatter, originalFile)
  const spawnSpec = buildProjectFormatterSpawn(command, args)
  const result = await runBoundedWorkspaceCommand({
    command: spawnSpec.command,
    args: spawnSpec.args,
    windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
    cwd,
    env: buildProjectFormatterEnv(formatter.env),
    timeoutMs: PROJECT_FORMATTER_TIMEOUT_MS,
    outputLimitBytes: PROJECT_FORMATTER_OUTPUT_LIMIT,
    label: `formatter:${formatter.id}`,
    beforeSpawn: async () => {
      await workspaceMutationTestHook?.("format:before-spawn", {
        root: cwd,
        source: staged.path,
        target: originalFile,
      })
      const revalidated = await resolveWorkspaceOperationPath(cwd, relativePath)
      if (revalidated.root !== cwd || revalidated.target !== originalFile) {
        throw workspacePathChanged("formatter target changed before spawn")
      }
      await assertWorkspaceRegularFileUnchanged(originalFile, expectedTarget)
    },
    watchedFile: {
      path: staged.path,
      maxBytes: PROJECT_FORMATTER_ACCEPTED_OUTPUT_LIMIT_BYTES,
      expectedIdentity: staged.snapshot.identity,
      parentChain: staged.parentChain,
    },
  })
  return {
    id: formatter.id,
    name: formatter.name,
    sourcePath: formatter.sourcePath,
    command: reported.command,
    args: reported.args,
    success:
      result.exitCode === 0 &&
      !result.failure &&
      !result.timedOut &&
      !result.outputExceeded &&
      !result.fileOutputExceeded &&
      !result.watchedFileError &&
      !result.treeError,
    exitCode: result.exitCode,
    signal: result.signal ?? undefined,
    stdout: result.stdout,
    stderr: [
      result.stderr,
      result.outputExceeded
        ? `Formatter output exceeded ${PROJECT_FORMATTER_OUTPUT_LIMIT} bytes.`
        : "",
      result.fileOutputExceeded
        ? `Formatter file output exceeded ${PROJECT_FORMATTER_ACCEPTED_OUTPUT_LIMIT_BYTES} bytes.`
        : "",
      result.watchedFileError ?? "",
      result.treeError
        ? `Formatter process tree did not settle: ${result.treeError}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    timedOut: result.timedOut,
  }
}

/**
 * cmd.exe refuses lines over 8191 characters; the budget leaves room for
 * `cmd.exe /d /s /c` itself and the outer quote pair. Exported for tests.
 */
export const WINDOWS_CMD_LINE_BUDGET_CHARS = 7_000

/**
 * How a formatter is actually spawned. On Windows anything that is not an
 * absolute `.exe` (npm `.cmd` shims, bare names) has to go through cmd.exe,
 * and the argument line is then built by the shared, audited quoter — the
 * previous local caret-quoter turned a filename containing `"` plus `&` into
 * a second command. Exported so the quoting can be tested without a spawn.
 */
export function buildProjectFormatterSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): {
  readonly command: string
  readonly args: string[]
  readonly windowsVerbatimArguments: boolean
} {
  if (!requiresWindowsCmdWrapper(command, platform)) {
    return { command, args: [...args], windowsVerbatimArguments: false }
  }
  // Two things no quoting can fix on the cmd.exe path (see the header of
  // windowsCommandLine.ts): cmd reads the `/c` line only up to the first
  // line break, so an argument with a newline silently truncates the
  // command, and the whole line has to stay under cmd's 8191-character
  // limit. Formatters take one file per invocation, so there is no list to
  // chunk — an over-long line here is a pathological path or template, and
  // the honest answer is a clear error rather than a cut-off command.
  const offending = [command, ...args].find((value) => /[\r\n]/.test(value))
  if (offending !== undefined) {
    throw Object.assign(
      new Error(
        "Formatter command or argument contains a line break, which cmd.exe would truncate the command at."
      ),
      { statusCode: 400, code: "formatter_argument_line_break" }
    )
  }
  const cmdArgs = buildWindowsCmdArgs(command, args)
  const line = cmdArgs[cmdArgs.length - 1] ?? ""
  if (line.length > WINDOWS_CMD_LINE_BUDGET_CHARS) {
    throw Object.assign(
      new Error(
        `Formatter command line is ${line.length} characters; cmd.exe allows at most ${WINDOWS_CMD_LINE_BUDGET_CHARS} here.`
      ),
      { statusCode: 400, code: "formatter_command_line_too_long" }
    )
  }
  return {
    command: resolveComSpec(),
    args: cmdArgs,
    windowsVerbatimArguments: true,
  }
}

function buildProjectFormatterCommand(
  formatter: ProjectFormatterTemplate,
  file: string
): { command: string; args: string[] } {
  const allArgs = formatter.args.map((arg) => arg.replace(/\$FILE/g, file))
  const command = formatter.command.replace(/\$FILE/g, file)
  const hasFilePlaceholder =
    formatter.command.includes("$FILE") ||
    formatter.args.some((arg) => arg.includes("$FILE"))
  return {
    command,
    args: hasFilePlaceholder ? allArgs : [...allArgs, file],
  }
}

function buildProjectFormatterEnv(
  env: Record<string, string>
): NodeJS.ProcessEnv {
  return sanitizedShellEnvironment(
    Object.fromEntries(
      Object.entries(env).filter(
        ([key, value]) =>
          isSafeShellEnvironmentOverrideKey(key) && value.length <= 16_384
      )
    )
  )
}

function projectFormatterFromBuiltin(
  formatter: BuiltinFormatterDefinition,
  sourcePath: string
): ProjectFormatterTemplate {
  return {
    id: formatter.id,
    name: formatter.name,
    enabled: true,
    sourcePath: `${sourcePath}.${formatter.id}`,
    command: "",
    args: [],
    env: formatter.env ?? {},
    extensions: formatter.extensions,
    builtin: true,
  }
}

/**
 * Executable lookups stat every PATH entry (times four candidates on
 * Windows) and ran on every format request. Availability rarely changes, so
 * the answer is cached per (workspace, binary, PATH) for a minute. The local
 * `node_modules/.bin` mtime is part of the key so an `npm install` that adds
 * the formatter is seen immediately.
 */
const EXECUTABLE_LOOKUP_TTL_MS = 60_000
const EXECUTABLE_LOOKUP_CACHE_MAX_ENTRIES = 256
const executableLookupCache = new Map<
  string,
  { readonly expiresAt: number; readonly value: string | null }
>()

function findExecutableOnPath(
  binName: string,
  workspaceRoot: string
): string | null {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin")
  let localBinMtime = 0
  try {
    localBinMtime = fsSync.statSync(localBin).mtimeMs
  } catch {
    // No local bin directory; PATH decides.
  }
  const pathValue = process.env.PATH ?? ""
  const key = [workspaceRoot, binName, String(localBinMtime), pathValue].join(
    "\u0000"
  )
  const now = Date.now()
  const cached = executableLookupCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  const value = findExecutableOnPathUncached(binName, localBin, pathValue)
  executableLookupCache.delete(key)
  executableLookupCache.set(key, {
    expiresAt: now + EXECUTABLE_LOOKUP_TTL_MS,
    value,
  })
  while (executableLookupCache.size > EXECUTABLE_LOOKUP_CACHE_MAX_ENTRIES) {
    const oldest = executableLookupCache.keys().next()
    if (oldest.done) break
    executableLookupCache.delete(oldest.value)
  }
  return value
}

function findExecutableOnPathUncached(
  binName: string,
  localBin: string,
  pathValue: string
): string | null {
  const localMatch = findExecutableCandidate(path.join(localBin, binName))
  if (localMatch) return localMatch

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue
    const match = findExecutableCandidate(path.join(directory, binName))
    if (match) return match
  }
  return null
}

function findExecutableCandidate(basePath: string): string | null {
  const candidates =
    process.platform === "win32"
      ? [basePath, `${basePath}.cmd`, `${basePath}.exe`, `${basePath}.bat`]
      : [basePath]
  return candidates.find(isExecutableFile) ?? null
}

function findUpFileSync(
  fileName: string,
  startDirectory: string,
  workspaceRoot: string
): string[] {
  const root = path.resolve(workspaceRoot)
  let directory = path.resolve(startDirectory)
  const out: string[] = []

  while (
    directory === root ||
    (!path.relative(root, directory).startsWith("..") &&
      !path.isAbsolute(path.relative(root, directory)))
  ) {
    const candidate = path.join(directory, fileName)
    if (fsSync.existsSync(candidate)) out.push(candidate)
    if (directory === root) break
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  return out
}

function packageJsonHasDependency(
  workspaceRoot: string,
  filePath: string,
  packageName: string
): boolean {
  return findUpFileSync("package.json", path.dirname(filePath), workspaceRoot)
    .map(readJsonRecordSync)
    .some(
      (json) =>
        hasStringRecordKey(json.dependencies, packageName) ||
        hasStringRecordKey(json.devDependencies, packageName)
    )
}

function composerJsonHasDependency(
  workspaceRoot: string,
  filePath: string,
  packageName: string
): boolean {
  return findUpFileSync("composer.json", path.dirname(filePath), workspaceRoot)
    .map(readJsonRecordSync)
    .some(
      (json) =>
        hasStringRecordKey(json.require, packageName) ||
        hasStringRecordKey(json["require-dev"], packageName)
    )
}

function readJsonRecordSync(filePath: string): Record<string, unknown> {
  try {
    return readUnknownRecord(
      JSON.parse(fsSync.readFileSync(filePath, "utf8")) as unknown
    )
  } catch {
    return {}
  }
}

function hasStringRecordKey(value: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(readStringRecord(value), key)
}

function isBetterC0deExperimentalFlagEnabled(name: string): boolean {
  return (
    isTruthyEnv(process.env.BetterC0de_EXPERIMENTAL) ||
    isTruthyEnv(process.env[name])
  )
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function resolveRuffFormatterCommand(
  workspaceRoot: string,
  filePath: string
): string[] | null {
  const ruff = findExecutableOnPath("ruff", workspaceRoot)
  if (!ruff) return null

  const start = path.dirname(filePath)
  for (const config of ["pyproject.toml", "ruff.toml", ".ruff.toml"]) {
    const [found] = findUpFileSync(config, start, workspaceRoot)
    if (!found) continue
    if (config === "pyproject.toml") {
      if (readTextFileSync(found).includes("[tool.ruff]")) {
        return [ruff, "format", "$FILE"]
      }
      continue
    }
    return [ruff, "format", "$FILE"]
  }

  for (const dep of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    const [found] = findUpFileSync(dep, start, workspaceRoot)
    if (found && readTextFileSync(found).includes("ruff")) {
      return [ruff, "format", "$FILE"]
    }
  }

  return null
}

function readTextFileSync(filePath: string): string {
  let fd: number | null = null
  try {
    const before = fsSync.lstatSync(filePath)
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.size > PROJECT_COMMAND_MAX_BYTES
    ) {
      return ""
    }
    fd = fsSync.openSync(filePath, fsSync.constants.O_RDONLY | NO_FOLLOW_FLAG)
    const opened = fsSync.fstatSync(fd)
    if (
      !opened.isFile() ||
      !sameWorkspacePathIdentity(
        workspacePathIdentity(before),
        workspacePathIdentity(opened)
      )
    ) {
      return ""
    }
    const buffer = Buffer.allocUnsafe(PROJECT_COMMAND_MAX_BYTES + 1)
    let total = 0
    while (total < buffer.byteLength) {
      const bytesRead = fsSync.readSync(
        fd,
        buffer,
        total,
        buffer.byteLength - total,
        total
      )
      if (bytesRead === 0) break
      total += bytesRead
    }
    const after = fsSync.fstatSync(fd)
    if (
      total > PROJECT_COMMAND_MAX_BYTES ||
      total !== after.size ||
      !sameWorkspacePathIdentity(
        workspacePathIdentity(opened),
        workspacePathIdentity(after)
      )
    ) {
      return ""
    }
    return buffer.subarray(0, total).toString("utf8")
  } catch {
    return ""
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd)
      } catch {
        // The read already failed closed.
      }
    }
  }
}

const AIR_FORMATTER_PROBE_TTL_MS = 5 * 60 * 1_000

const AIR_FORMATTER_PROBE_MAX_ENTRIES = 32

const airFormatterProbeCache = new Map<
  string,
  { readonly value: boolean; readonly expiresAt: number }
>()

const airFormatterProbeInFlight = new Map<string, Promise<boolean>>()

async function isAirFormatterBinary(binPath: string): Promise<boolean> {
  let fingerprint = binPath
  try {
    const stat = fsSync.statSync(binPath)
    fingerprint = `${binPath}\u0000${stat.size}\u0000${stat.mtimeMs}`
  } catch {
    return false
  }
  const now = Date.now()
  const cached = airFormatterProbeCache.get(fingerprint)
  if (cached && cached.expiresAt > now) return cached.value
  if (cached) airFormatterProbeCache.delete(fingerprint)
  const existing = airFormatterProbeInFlight.get(fingerprint)
  if (existing) return await existing

  const probe = (async () => {
    const probeSpawn = buildProjectFormatterSpawn(binPath, ["--help"])
    const output = await runBoundedWorkspaceCommand({
      command: probeSpawn.command,
      args: probeSpawn.args,
      windowsVerbatimArguments: probeSpawn.windowsVerbatimArguments,
      env: sanitizedShellEnvironment(),
      timeoutMs: 5_000,
      outputLimitBytes: 64_000,
      label: "formatter-probe:air",
    })
    const firstLine = `${output.stdout}${output.stderr}`.split("\n")[0]
    const value =
      output.exitCode === 0 &&
      !output.failure &&
      !output.timedOut &&
      !output.outputExceeded &&
      !output.treeError &&
      firstLine.includes("R language") &&
      firstLine.includes("formatter")
    airFormatterProbeCache.set(fingerprint, {
      value,
      expiresAt: Date.now() + AIR_FORMATTER_PROBE_TTL_MS,
    })
    while (airFormatterProbeCache.size > AIR_FORMATTER_PROBE_MAX_ENTRIES) {
      const oldest = airFormatterProbeCache.keys().next().value
      if (oldest === undefined) break
      airFormatterProbeCache.delete(oldest)
    }
    return value
  })()
  airFormatterProbeInFlight.set(fingerprint, probe)
  try {
    return await probe
  } finally {
    if (airFormatterProbeInFlight.get(fingerprint) === probe) {
      airFormatterProbeInFlight.delete(fingerprint)
    }
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fsSync.statSync(filePath)
    if (!stat.isFile()) return false
    if (process.platform === "win32") return true
    fsSync.accessSync(filePath, fsSync.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function projectFormattersFromConfig(
  formatterConfig: unknown,
  sourcePath: string
): ProjectFormatterTemplate[] {
  if (typeof formatterConfig === "boolean") {
    if (formatterConfig) {
      return OPEN_CODE_BUILTIN_FORMATTERS.map((formatter) =>
        projectFormatterFromBuiltin(formatter, `${sourcePath}#formatter`)
      )
    }
    return [
      {
        id: "builtins",
        name: "BetterC0de built-in formatters",
        enabled: formatterConfig,
        sourcePath: `${sourcePath}#formatter`,
        command: "",
        args: [],
        env: {},
        extensions: [],
        builtin: true,
      },
    ]
  }

  if (
    !formatterConfig ||
    typeof formatterConfig !== "object" ||
    Array.isArray(formatterConfig)
  ) {
    return []
  }

  const rawFormatters = formatterConfig as Record<string, unknown>
  const byId = new Map<string, ProjectFormatterTemplate>()
  for (const formatter of OPEN_CODE_BUILTIN_FORMATTERS) {
    byId.set(
      formatter.id,
      projectFormatterFromBuiltin(formatter, `${sourcePath}#formatter`)
    )
  }

  const ruffOrUvDisabled =
    projectFormatterConfigDisabled(rawFormatters.ruff) ||
    projectFormatterConfigDisabled(rawFormatters.uv)

  for (const [id, rawFormatter] of Object.entries(rawFormatters)) {
    if ((id === "ruff" || id === "uv") && ruffOrUvDisabled) {
      byId.delete("ruff")
      byId.delete("uv")
      continue
    }

    if (projectFormatterConfigDisabled(rawFormatter)) {
      byId.delete(id)
      continue
    }

    const formatter = projectFormatterFromConfig(id, rawFormatter, sourcePath)
    if (formatter) byId.set(formatter.id, formatter)
  }

  return Array.from(byId.values())
}

function projectFormatterConfigDisabled(rawFormatter: unknown): boolean {
  if (
    !rawFormatter ||
    typeof rawFormatter !== "object" ||
    Array.isArray(rawFormatter)
  ) {
    return false
  }
  return (
    readBoolean((rawFormatter as Record<string, unknown>).disabled) === true
  )
}

function projectFormatterFromConfig(
  id: string,
  rawFormatter: unknown,
  sourcePath: string
): ProjectFormatterTemplate | null {
  if (
    !rawFormatter ||
    typeof rawFormatter !== "object" ||
    Array.isArray(rawFormatter)
  ) {
    return null
  }

  const formatter = rawFormatter as Record<string, unknown>
  const command = readStringArray(formatter.command)
  const disabled = readBoolean(formatter.disabled) === true
  const builtin = OPEN_CODE_BUILTIN_FORMATTER_BY_ID.get(id)
  const extensions = readStringArray(formatter.extensions)
  return {
    id,
    name: id,
    enabled: !disabled,
    sourcePath: `${sourcePath}#formatter.${id}`,
    command: command[0] ?? "",
    args: command.slice(1),
    env: {
      ...(builtin?.env ?? {}),
      ...readStringRecord(formatter.environment),
    },
    extensions:
      extensions.length > 0 ? extensions : (builtin?.extensions ?? []),
    builtin: command.length === 0,
  }
}

export function readConfigValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined
  return (input as Record<string, unknown>)[key]
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, item]) => [key, item] as const)
  return Object.fromEntries(entries)
}

export function readUnknownRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
