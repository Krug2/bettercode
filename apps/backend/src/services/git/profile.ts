/**
 * The user's git identity for commit attribution.
 */

import fs from "node:fs"
import { gitRun } from "./process"

const GIT_PROFILE_TIMEOUT_MS = 3_000

export interface GitUserProfile {
  name: string | null
  email: string | null
  githubUser: string | null
}

const GITHUB_HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i

const GITHUB_NOREPLY_EMAIL_RE =
  /^(?:\d+\+)?([a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38})@users\.noreply\.github\.com$/i

function normalizeGitProfileValue(value: string): string | null {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character
  }).join("")
  const normalized = withoutControlCharacters
    .trim()
    .replace(/\s+/g, " ")
  return normalized.length > 0 ? normalized.slice(0, 1_024) : null
}

async function readGitConfigValue(
  cwd: string,
  key: "user.name" | "user.email" | "github.user"
): Promise<string | null> {
  try {
    const { stdout } = await gitRun(cwd, ["config", "--get", key], {
      timeoutMs: GIT_PROFILE_TIMEOUT_MS,
    })
    return normalizeGitProfileValue(stdout)
  } catch {
    // An unset config key exits with status 1. Profile metadata is optional,
    // so a missing key must not make the entire startup request fail.
    return null
  }
}

async function profileWorkingDirectory(cwd?: string | null): Promise<string> {
  const candidate = cwd?.trim()
  if (!candidate) return process.cwd()
  try {
    return (await fs.promises.stat(candidate)).isDirectory()
      ? candidate
      : process.cwd()
  } catch {
    return process.cwd()
  }
}

/**
 * Read the effective Git identity for a workspace without going through the
 * general-purpose shell endpoint. Local repository config therefore correctly
 * overrides the user's global config, while an absent local value naturally
 * falls back to the global Git setting.
 */
export async function userProfile(
  cwd?: string | null
): Promise<GitUserProfile> {
  const effectiveCwd = await profileWorkingDirectory(cwd)
  const [name, email, configuredGithubUser] = await Promise.all([
    readGitConfigValue(effectiveCwd, "user.name"),
    readGitConfigValue(effectiveCwd, "user.email"),
    readGitConfigValue(effectiveCwd, "github.user"),
  ])

  const explicitGithubUser =
    configuredGithubUser && GITHUB_HANDLE_RE.test(configuredGithubUser)
      ? configuredGithubUser
      : null
  const noreplyGithubUser = email?.match(GITHUB_NOREPLY_EMAIL_RE)?.[1] ?? null
  const nameGithubUser = name && GITHUB_HANDLE_RE.test(name) ? name : null

  return {
    name,
    email,
    githubUser: explicitGithubUser ?? noreplyGithubUser ?? nameGithubUser,
  }
}
