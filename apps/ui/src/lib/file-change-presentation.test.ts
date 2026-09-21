import { describe, expect, it } from "vitest"
import { groupFileChanges } from "@betterc0de/schema"

const file = (path: string) => Object.freeze({ path, additions: 7, deletions: 2 })

describe("file change presentation", () => {
  it("separates browser artifacts without dropping files or counting them as project edits", () => {
    const files = Object.freeze([
      file(".tmp-shots/profile/Default/Extensions/ext/_locales/de/messages.json"),
      file(".tmp-shots/desktop.png"), file(".tmp-server.log"),
      file(".next/cache/index.bin"), file("browser-profile/Default/LOCK"),
      file("src/components/hero.tsx"), file(".gitignore"),
    ])
    const grouped = groupFileChanges(files)
    expect(grouped.projectFiles.map(item => item.path)).toEqual(["src/components/hero.tsx", ".gitignore"])
    expect(grouped.generatedFiles).toHaveLength(5)
    expect(grouped.additions).toBe(14)
    expect(grouped.deletions).toBe(4)
    expect(new Set([...grouped.projectFiles, ...grouped.generatedFiles])).toEqual(new Set(files))
  })

  it("does not classify actual project assets, logs or generic database names as temporary", () => {
    const files = ["public/desktop.png", "src/profile/index.tsx", "fixtures/test.log", "data/LOCK", "State/db", "Tokens", "docs/cache.md", "my.tmp.ts"].map(file)
    expect(groupFileChanges(files).generatedFiles).toEqual([])
  })

  it("normalizes Windows paths and ignores temporary ancestors outside the workspace", () => {
    const source = file("C:\\temp\\.tmp-work\\project\\src\\hero.tsx")
    const generated = file("c:\\temp\\.tmp-work\\project\\.tmp-shots\\profile\\Crashpad\\metadata")
    const grouped = groupFileChanges([source, generated], "C:\\temp\\.tmp-work\\project\\")
    expect(grouped.projectFiles).toEqual([source])
    expect(grouped.generatedFiles).toEqual([generated])
  })
})
