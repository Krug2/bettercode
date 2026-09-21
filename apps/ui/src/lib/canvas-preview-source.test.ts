import { describe, expect, it } from "vitest"
import { normalizePreviewUrl, readPreviewSource } from "./canvas-preview-source"

describe("canvas preview source", () => {
  it("restores explicit choices ahead of legacy server URLs", () => {
    expect(readPreviewSource({ kind: "html", relativePath: "pages/home.html" }, "http://localhost:3000")).toEqual({ kind: "html", relativePath: "pages/home.html" })
    expect(readPreviewSource({ kind: "server" }, "http://old:4000")).toEqual({ kind: "server" })
    expect(readPreviewSource(undefined, "localhost:3000")).toEqual({ kind: "url", url: "http://localhost:3000/" })
    expect(readPreviewSource({ kind: "url", url: false })).toEqual({ kind: "server" })
    expect(readPreviewSource(null, 123)).toEqual({ kind: "server" })
  })
  it("allows web URLs and rejects file, executable, authenticated and malformed input", () => {
    expect(normalizePreviewUrl(" localhost:3003/path?q=hello ")).toBe("http://localhost:3003/path?q=hello")
    expect(normalizePreviewUrl("https://example.org/demo")).toBe("https://example.org/demo")
    for (const value of ["", "ftp://example.org", "file:///C:/secret.html", "javascript:alert(1)", "data:text/html,hello", "https://user:pass@example.org", "http://", "http://a b", "betterc0de-html://forged/index.html"]) {
      expect(normalizePreviewUrl(value), value).toBeNull()
    }
  })
})
