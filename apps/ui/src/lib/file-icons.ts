import { assetUrl } from "@/lib/asset-url"
import material from "@/lib/material-icon-theme.generated.json"

const fileNames = new Map(Object.entries(material.fileNames))
const extensions = new Map(Object.entries(material.fileExtensions))
const folderNames = new Map(Object.entries(material.folderNames))
const expandedFolders = new Map(Object.entries(material.folderExpanded))
const icons = new Map(Object.entries(material.icons))

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

// Some upstream associations include a parent directory (e.g. GitHub workflows).
// Prefer the most specific suffix and fall back to the ordinary basename.
function namedIcon(names: Map<string, string>, path: string): string | undefined {
  let candidate = path
  while (candidate) {
    const icon = names.get(candidate)
    if (icon) return icon
    const slash = candidate.indexOf("/")
    if (slash < 0) break
    candidate = candidate.slice(slash + 1)
  }
}

function iconUrl(id: string): string {
  return assetUrl(`file-icons/${icons.get(id) ?? icons.get(material.file)}`)
}

export function getFileIconUrl(filePath: string): string {
  const path = normalizedPath(filePath)
  const named = namedIcon(fileNames, path)
  if (named) return iconUrl(named)
  const name = path.slice(path.lastIndexOf("/") + 1)
  let dot = name.indexOf(".")
  while (dot >= 0) {
    const icon = extensions.get(name.slice(dot + 1))
    if (icon) return iconUrl(icon)
    dot = name.indexOf(".", dot + 1)
  }
  return iconUrl(material.file)
}

export function getFolderIconUrl(open: boolean, folderPath = "", root = false): string {
  const named = namedIcon(folderNames, normalizedPath(folderPath))
  if (!named && root) return iconUrl(open ? material.rootFolderExpanded : material.rootFolder)
  const icon = named ?? material.folder
  return iconUrl(open ? expandedFolders.get(icon) ?? icon : icon)
}
