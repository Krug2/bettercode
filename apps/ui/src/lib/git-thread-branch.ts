const TEMP_WORKTREE_BRANCH_PATTERN =
  /^agent\/[0-9a-f]{8}\/[a-z0-9]+(?:-[a-z0-9]+)*$/i

export function isTemporaryWorktreeBranch(refName: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(refName.trim())
}

function normalizeBranchName(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveLiveThreadBranchUpdate(input: {
  readonly threadBranch: string | null | undefined
  readonly gitBranch: string | null | undefined
}): { readonly branch: string | null } | null {
  const threadBranch = normalizeBranchName(input.threadBranch)
  const gitBranch = normalizeBranchName(input.gitBranch)

  if (gitBranch === null && threadBranch !== null) {
    return null
  }

  if (threadBranch === gitBranch) {
    return null
  }

  if (
    threadBranch !== null &&
    gitBranch !== null &&
    !isTemporaryWorktreeBranch(threadBranch) &&
    isTemporaryWorktreeBranch(gitBranch)
  ) {
    return null
  }

  return { branch: gitBranch }
}
