import { describe, expect, it } from "vitest"
import {
  getEditorFileKind,
  getEditorFileMimeType,
  isTextEditorFile,
} from "@/lib/editor-file-kind"

describe("editor file routing", () => {
  it.each([
    ["src/app.tsx", "text"],
    ["Dockerfile", "text"],
    [".env.local", "text"],
    ["notes.unknown-source", "text"],
    ["assets/logo.PNG", "image"],
    ["assets/icon.svg", "image"],
    ["docs/manual.pdf", "pdf"],
    ["media/demo.webm", "video"],
    ["media/theme.flac", "audio"],
    ["archive/app.zip", "binary"],
    ["build/program.exe", "binary"],
  ] as const)("routes %s to %s", (filePath, expected) => {
    expect(getEditorFileKind(filePath)).toBe(expected)
  })

  it("keeps Monaco limited to editable text files", () => {
    expect(isTextEditorFile("src/main.rs")).toBe(true)
    expect(isTextEditorFile("assets/logo.png")).toBe(false)
    expect(isTextEditorFile("data/app.sqlite")).toBe(false)
  })

  it("provides browser-safe media types for previews", () => {
    expect(getEditorFileMimeType("logo.webp")).toBe("image/webp")
    expect(getEditorFileMimeType("clip.mp4")).toBe("video/mp4")
    expect(getEditorFileMimeType("sound.ogg")).toBe("audio/ogg")
    expect(getEditorFileMimeType("manual.pdf")).toBe("application/pdf")
    expect(getEditorFileMimeType("archive.zip")).toBe(
      "application/octet-stream"
    )
  })
})
