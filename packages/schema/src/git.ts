import { z } from "zod"
import { CHECKPOINT_REFS_PREFIX } from "./checkpointing"

function hasGitControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x20 || codePoint === 0x7f
  })
}

const gitPathSchema = z
  .string()
  .min(1)
  .max(8_192)
  .refine((value) => value.trim().length > 0, "Git paths must not be blank")
  .refine((value) => !value.includes("\0"), "Git paths must not contain NUL")
const gitCommitMessageSchema = z
  .string()
  .min(1)
  .max(1024 * 1024)
  .refine((value) => value.trim().length > 0, "Message must not be blank")
const gitArgumentMessageSchema = z
  .string()
  .min(1)
  .max(16 * 1024)
  .refine((value) => value.trim().length > 0, "Message must not be blank")

export const gitCwdSchema = z
  .object({
    cwd: gitPathSchema,
  })
  .strict()

export const gitProfileSchema = z
  .object({
    cwd: gitPathSchema.nullable().optional(),
  })
  .strict()

export type GitProfileBody = z.infer<typeof gitProfileSchema>

const gitNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) => !value.startsWith("-"),
    "Git names must not start with '-'"
  )
  .refine(
    (value) =>
      !hasGitControlCharacter(value) &&
      !/[~^:?*[\]\\]/.test(value) &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !value.includes("//") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.split("/").some((part) => part.endsWith(".lock")),
    "Invalid Git name"
  )

const gitRemoteNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Invalid Git remote name")

const checkpointRefSchema = z
  .string()
  .trim()
  .min(CHECKPOINT_REFS_PREFIX.length + 2)
  .max(1_024)
  .refine(
    (value) => value.startsWith(`${CHECKPOINT_REFS_PREFIX}/`),
    "Checkpoint ref is outside the BetterC0de checkpoint namespace"
  )
  .and(gitNameSchema)

/** Push body — `cwd` is the only required field; optional flags allow
 *  the renderer to publish a fresh branch (`-u origin <branch>`) without
 *  defining a separate endpoint. */
export const gitPushSchema = z
  .object({
    cwd: gitPathSchema,
    setUpstream: z.boolean().optional(),
    branch: gitNameSchema.optional(),
    remote: gitRemoteNameSchema.optional(),
  })
  .strict()

export const gitCommitSchema = z
  .object({
    cwd: gitPathSchema,
    message: gitCommitMessageSchema,
  })
  .strict()

export const gitDiscardSchema = z
  .object({
    cwd: gitPathSchema,
    path: gitPathSchema.optional(),
    file: gitPathSchema.optional(),
  })
  .strict()
  .refine((raw) => raw.path !== undefined || raw.file !== undefined, {
    message: "path is required",
  })
  .transform((raw) => ({
    cwd: raw.cwd,
    path: raw.path ?? raw.file!,
  }))

export const gitOpenEditorSchema = z
  .object({
    path: gitPathSchema,
    editor: z.string().trim().min(1).max(1_024),
  })
  .strict()

export const gitLogSchema = z
  .object({
    cwd: gitPathSchema,
    count: z.coerce.number().int().min(1).max(1_000).default(20),
  })
  .strict()

export const gitCheckoutSchema = z
  .object({
    cwd: gitPathSchema,
    branch: gitNameSchema,
    create: z.boolean().default(false),
  })
  .strict()

export const gitStashSchema = z
  .object({
    cwd: gitPathSchema,
    message: gitArgumentMessageSchema.optional(),
  })
  .strict()

export const gitBranchRenameSchema = z
  .object({
    cwd: gitPathSchema,
    oldName: gitNameSchema,
    newName: gitNameSchema,
  })
  .strict()

export const gitWorktreeCreateSchema = z
  .object({
    cwd: gitPathSchema,
    worktreePath: gitPathSchema,
    branch: gitNameSchema,
    baseBranch: gitNameSchema,
  })
  .strict()

export const gitWorktreeRemoveSchema = z
  .object({
    cwd: gitPathSchema,
    worktreePath: gitPathSchema,
    force: z.boolean().optional(),
  })
  .strict()

export const gitPathsSchema = z
  .object({
    cwd: gitPathSchema,
    paths: z
      .array(gitPathSchema)
      .max(1_000)
      .superRefine((paths, context) => {
        const characters = paths.reduce(
          (total, current) => total + current.length + 1,
          0
        )
        if (characters > 1024 * 1024) {
          context.addIssue({
            code: "custom",
            message: "Git path list exceeds 1 MiB",
          })
        }
      })
      .default([]),
  })
  .strict()

const gitHunkPatchSchema = z
  .string()
  .min(1)
  .max(8 * 1024 * 1024)
  .refine((value) => !value.includes("\0"), "Git patches must not contain NUL")
  .refine(
    (value) => value.replace(/\r\n?/g, "\n").startsWith("diff --git "),
    "Git hunk patch must include a file header"
  )
  .refine(
    (value) =>
      (value.replace(/\r\n?/g, "\n").match(/^@@ /gm) ?? []).length === 1,
    "Git hunk patch must include exactly one text hunk"
  )

export const gitHunkActionSchema = z
  .object({
    cwd: gitPathSchema,
    path: gitPathSchema,
    source: z.enum(["unstaged", "staged"]),
    action: z.enum(["accept", "reject", "unstage"]),
    patch: gitHunkPatchSchema,
    operationId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/, "Invalid hunk operation id")
      .optional(),
    expectedPatchId: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "Invalid expected patch id")
      .optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.source === "unstaged" &&
        (value.action === "accept" || value.action === "reject")) ||
      (value.source === "staged" && value.action === "unstage")
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message:
          "Unstaged hunks may be accepted or rejected; staged hunks may be unstaged",
      })
    }
  })

export type GitHunkActionInput = z.infer<typeof gitHunkActionSchema>

export interface GitHunkActionResult {
  ok: true
  action: GitHunkActionInput["action"]
  patchId: string
  applied: boolean
  replayed?: boolean
}

/**
 * Response shape of `POST /git/status`. Produced by
 * `apps/backend/src/services/git.ts` and rendered by the git panel. Shared
 * here so a backend shape change fails both typechecks instead of drifting
 * silently (the panel used to keep its own hand-copied twin).
 */
export interface GitStatus {
  branch: string
  is_clean: boolean
  staged: string[]
  modified: string[]
  untracked: string[]
  /** Local commits ahead of `upstream` (0 when no upstream is set). */
  ahead: number
  /** Remote commits behind `upstream` (0 when no upstream is set). */
  behind: number
  /** `origin/main` etc. — null when the branch has no tracking branch
   *  configured (e.g. brand-new local branch never pushed). */
  upstream: string | null
}

export const gitRemoteAddSchema = z
  .object({
    cwd: gitPathSchema,
    name: gitRemoteNameSchema,
    url: z.string().trim().min(1).max(8_192),
  })
  .strict()

export const gitCheckpointSchema = z
  .object({
    cwd: gitPathSchema,
    checkpointRef: checkpointRefSchema,
    fallbackToHead: z.boolean().optional(),
  })
  .strict()

export const gitCheckpointDiffSchema = z
  .object({
    cwd: gitPathSchema,
    fromCheckpointRef: checkpointRefSchema,
    toCheckpointRef: checkpointRefSchema,
    fallbackFromToHead: z.boolean().optional(),
    ignoreWhitespace: z.boolean().optional(),
  })
  .strict()

export const gitCheckpointDeleteSchema = z
  .object({
    cwd: gitPathSchema,
    checkpointRefs: z.array(checkpointRefSchema).max(1_000).default([]),
  })
  .strict()
