export function relativeEditorPath(
  projectPath: string | null | undefined,
  filePath: string
): string {
  const relative = workspaceRelativeEditorPath(projectPath, filePath)
  if (relative !== null) return relative || basename(filePath)
  return normalizeEditorPath(filePath)
}

export function workspaceRelativeEditorPath(
  projectPath: string | null | undefined,
  filePath: string
): string | null {
  if (!projectPath) return null
  const normalizedProject = normalizeEditorPath(projectPath).replace(/\/+$/, "")
  const normalizedFile = normalizeEditorPath(filePath)
  const projectLower = normalizedProject.toLowerCase()
  const fileLower = normalizedFile.toLowerCase()
  if (fileLower === projectLower) return ""
  if (fileLower.startsWith(`${projectLower}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1)
  }
  return null
}

export function normalizeEditorPath(value: string): string {
  return value.replace(/\\/g, "/")
}

/** Stable Monaco identity: backslashes, spaces, # and ? must stay path data. */
export function editorModelUri(filePath: string): string {
  // URL.pathname preserves existing escapes, so escape literal percent signs first.
  const normalized = normalizeEditorPath(filePath).replace(/%/g, "%25")
  const uri = new URL("file:///")
  if (normalized.startsWith("//")) {
    const endHost = normalized.indexOf("/", 2)
    uri.hostname = normalized.slice(2, endHost === -1 ? undefined : endHost)
    uri.pathname = endHost === -1 ? "/" : normalized.slice(endHost)
  } else {
    uri.pathname = normalized.startsWith("/") ? normalized : `/${normalized}`
  }
  return uri.href
}

export function isEditorPathEqualOrInside(
  filePath: string,
  targetPath: string
): boolean {
  const file = normalizeEditorPath(filePath).replace(/\/+$/, "")
  const target = normalizeEditorPath(targetPath).replace(/\/+$/, "")
  const fileLower = file.toLowerCase()
  const targetLower = target.toLowerCase()
  return fileLower === targetLower || fileLower.startsWith(`${targetLower}/`)
}

export function rebaseEditorPath(
  filePath: string,
  oldBasePath: string,
  newBasePath: string
): string | null {
  if (!isEditorPathEqualOrInside(filePath, oldBasePath)) return null
  const file = normalizeEditorPath(filePath).replace(/\/+$/, "")
  const oldBase = normalizeEditorPath(oldBasePath).replace(/\/+$/, "")
  const newBase = normalizeEditorPath(newBasePath).replace(/\/+$/, "")
  const suffix = file.slice(oldBase.length)
  return `${newBase}${suffix}`
}

export function isAbsoluteEditorPath(value: string): boolean {
  const normalized = normalizeEditorPath(value)
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[A-Za-z]:\//.test(normalized)
  )
}

export function resolveWorkspaceFilePath(
  projectPath: string,
  filePath: string
): string {
  if (isAbsoluteEditorPath(filePath)) return filePath
  const sep = projectPath.includes("\\") ? "\\" : "/"
  const base = projectPath.replace(/[\\/]+$/, "")
  const relative = normalizeEditorPath(filePath)
    .replace(/^\/+/, "")
    .replaceAll("/", sep)
  return relative ? `${base}${sep}${relative}` : base
}

export function editorPathAncestors(relativePath: string): string[] {
  const parts = normalizeEditorPath(relativePath).split("/").filter(Boolean)
  parts.pop()
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"))
}

function basename(value: string): string {
  return (
    normalizeEditorPath(value).replace(/\/+$/, "").split("/").pop() ?? value
  )
}
