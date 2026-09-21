import { describe, expect, it } from "vitest"
import {
  mergeProjectTreeChildren,
  projectDirectoryEntries,
  type ProjectTreeEntry,
} from "@/lib/project-file-tree-data"

describe("projectDirectoryEntries", () => {
  it("maps immediate absolute directory entries to project-relative tree nodes", () => {
    expect(
      projectDirectoryEntries("C:/repo", [
        { name: "nested", path: "C:/repo/src/nested", isDir: true },
        { name: "index.ts", path: "C:/repo/src/index.ts", isDir: false },
      ])
    ).toEqual([
      {
        name: "nested",
        path: "src/nested",
        type: "folder",
        children: [],
      },
      { name: "index.ts", path: "src/index.ts", type: "file" },
    ])
  })
})

describe("mergeProjectTreeChildren", () => {
  it("fills the requested nested folder without changing sibling nodes", () => {
    const tree: ProjectTreeEntry[] = [
      {
        name: "src",
        path: "src",
        type: "folder" as const,
        children: [
          {
            name: "components",
            path: "src/components",
            type: "folder" as const,
            children: [],
          },
        ],
      },
      { name: "README.md", path: "README.md", type: "file" as const },
    ]

    const merged = mergeProjectTreeChildren(tree, "src/components", [
      {
        name: "Button.tsx",
        path: "src/components/Button.tsx",
        type: "file",
      },
    ])

    expect(merged[0]?.children?.[0]?.children?.[0]?.path).toBe(
      "src/components/Button.tsx"
    )
    expect(merged[1]).toBe(tree[1])
  })
})
