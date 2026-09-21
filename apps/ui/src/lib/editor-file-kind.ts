export type EditorFileKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "binary"

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
}

const AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
}

const VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ogv: "video/ogg",
  webm: "video/webm",
}

const BINARY_EXTENSIONS = new Set([
  "7z",
  "a",
  "apk",
  "app",
  "bin",
  "bz2",
  "class",
  "db",
  "dll",
  "dmg",
  "doc",
  "docx",
  "dylib",
  "eot",
  "exe",
  "gz",
  "jar",
  "lib",
  "msi",
  "o",
  "odt",
  "otf",
  "pdb",
  "ppt",
  "pptx",
  "rar",
  "so",
  "sqlite",
  "sqlite3",
  "tar",
  "ttf",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "zip",
])

function extensionOf(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ""
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(dot + 1) : ""
}

export function getEditorFileKind(filePath: string): EditorFileKind {
  const extension = extensionOf(filePath)
  if (IMAGE_MIME_TYPES[extension]) return "image"
  if (AUDIO_MIME_TYPES[extension]) return "audio"
  if (VIDEO_MIME_TYPES[extension]) return "video"
  if (extension === "pdf") return "pdf"
  if (BINARY_EXTENSIONS.has(extension)) return "binary"
  return "text"
}

export function isTextEditorFile(filePath: string): boolean {
  return getEditorFileKind(filePath) === "text"
}

export function getEditorFileMimeType(filePath: string): string {
  const extension = extensionOf(filePath)
  return (
    IMAGE_MIME_TYPES[extension] ??
    AUDIO_MIME_TYPES[extension] ??
    VIDEO_MIME_TYPES[extension] ??
    (extension === "pdf" ? "application/pdf" : "application/octet-stream")
  )
}
