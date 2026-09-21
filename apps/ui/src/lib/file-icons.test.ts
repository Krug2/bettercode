import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { getFileIconUrl, getFolderIconUrl } from "./file-icons"
import material from "./material-icon-theme.generated.json"

describe("Material Icon Theme associations", () => {
  it.each([
    ["index.html", "html"], ["page.HTM", "html"],
    ["app.js", "javascript"], ["module.mjs", "javascript"],
    ["data.json", "json"], ["styles.css", "css"],
    ["app.tsx", "react_ts"], ["types.d.ts", "typescript-def"],
    ["C:\\repo\\package.json", "nodejs"], ["package-lock.json", "nodejs"],
    ["tsconfig.json", "tsconfig"], ["vite.config.ts", "vite"],
    ["next.config.ts", "next"], [".env.local", "tune"],
    ["README.md", "readme"], ["bun.lock", "bun"],
  ])("uses the upstream icon for %s", (name, icon) => {
    expect(getFileIconUrl(name)).toBe(`/file-icons/${icon}.svg`)
  })

  it.each([
    [".claude", "folder-claude"], ["app", "folder-app"],
    ["src/components", "folder-components"], ["data", "folder-database"],
    ["DOCS", "folder-docs"], ["hooks", "folder-hook"], ["lib", "folder-lib"],
    ["node_modules", "folder-node"], ["public", "folder-public"],
    ["C:\\repo\\scripts\\", "folder-scripts"], ["types", "folder-typescript"],
    ["supabase", "folder-supabase"], [".github/workflows", "folder-gh-workflows"],
  ])("distinguishes closed and expanded %s", (name, icon) => {
    expect(getFolderIconUrl(false, name)).toBe(`/file-icons/${icon}.svg`)
    expect(getFolderIconUrl(true, name)).toBe(`/file-icons/${icon}-open.svg`)
  })

  it("keeps unknown names and JavaScript prototype names safe", () => {
    expect(getFileIconUrl("unknown.weirdextension")).toBe("/file-icons/file.svg")
    expect(getFileIconUrl("constructor")).toBe("/file-icons/file.svg")
    expect(getFolderIconUrl(false, "__proto__")).toBe("/file-icons/folder.svg")
    expect(getFolderIconUrl(true, "my-project", true)).toBe("/file-icons/folder-root-open.svg")
  })

  it("ships every referenced SVG locally", () => {
    const missing = Object.values(material.icons).filter((file) =>
      !existsSync(new URL(`../../public/file-icons/${file}`, import.meta.url)))
    expect(missing).toEqual([])
  })
})
