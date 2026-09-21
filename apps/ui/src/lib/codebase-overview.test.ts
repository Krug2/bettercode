import { describe, expect, it } from "vitest"
import { buildCodebaseOverview } from "@/lib/codebase-overview"

describe("buildCodebaseOverview", () => {
  it("summarizes files, folders, languages, and key project files", () => {
    const overview = buildCodebaseOverview([
      { path: "src", name: "src", is_dir: true },
      { path: "src/App.tsx", name: "App.tsx", is_dir: false },
      { path: "src/main.tsx", name: "main.tsx", is_dir: false },
      { path: "src/index.css", name: "index.css", is_dir: false },
      { path: "package.json", name: "package.json", is_dir: false },
      { path: "vite.config.ts", name: "vite.config.ts", is_dir: false },
    ])

    expect(overview.totalFiles).toBe(5)
    expect(overview.totalFolders).toBe(1)
    expect(overview.languages[0]).toMatchObject({
      label: "TypeScript React",
      count: 2,
    })
    expect(overview.topFolders[0]).toMatchObject({ name: "src", count: 3 })
    expect(overview.keyFiles.map((file) => file.path)).toContain("package.json")
    expect(overview.frameworkHints.map((hint) => hint.label)).toEqual([
      "Node workspace",
      "Vite",
    ])
  })
})
