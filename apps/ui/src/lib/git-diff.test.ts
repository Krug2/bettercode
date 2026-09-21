import { describe, expect, it } from "vitest"

import {
  buildSplitDiffLines,
  extractGitHunkPatches,
  parseGitDiff,
} from "./git-diff"

const TWO_HUNK_DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const first = true
-const second = false
+const second = true
 const third = true
@@ -8 +8 @@ export function value() {
-  return 1
+  return 2
 }
`

describe("git diff model", () => {
  it("keeps real blank lines without inventing a line for the patch terminator", () => {
    const [file] = parseGitDiff(`diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n \n`)
    expect(file?.hunks[0]?.lines).toHaveLength(3)
    expect(file?.hunks[0]?.lines.at(-1)).toMatchObject({ type: "context", content: "", oldNum: 2, newNum: 2 })
  })

  it("does not confuse code beginning with plus/minus signs with file headers", () => {
    const [file] = parseGitDiff(`diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n---counter;\n+++counter;\n`)
    expect(file?.hunks[0]?.lines).toMatchObject([
      { type: "remove", content: "--counter;", oldNum: 1 },
      { type: "add", content: "++counter;", newNum: 1 },
    ])
    expect(file).toMatchObject({ additions: 1, deletions: 1 })
  })

  it("parses files and retains an exact independently applicable patch per hunk", () => {
    const [file] = parseGitDiff(TWO_HUNK_DIFF)

    expect(file).toMatchObject({
      name: "src/example.ts",
      additions: 2,
      deletions: 2,
      isBinary: false,
    })
    expect(file?.hunks).toHaveLength(2)
    expect(file?.hunks[0]?.patch).toContain(
      "diff --git a/src/example.ts b/src/example.ts"
    )
    expect(file?.hunks[0]?.patch).toContain("-const second = false")
    expect(file?.hunks[0]?.patch).not.toContain("-  return 1")
    expect(file?.hunks[1]).toMatchObject({
      oldCount: 1,
      newCount: 1,
    })
    expect(file?.hunks[1]?.patch).toContain("-  return 1")
  })

  it("normalizes line endings before producing stable hunk patches", () => {
    const patches = extractGitHunkPatches(
      TWO_HUNK_DIFF.replaceAll("\n", "\r\n")
    )

    expect(patches).toHaveLength(2)
    expect(patches.every((patch) => !patch.includes("\r"))).toBe(true)
    expect(patches.every((patch) => patch.endsWith("\n"))).toBe(true)
  })

  it("aligns adjacent removals and additions in split view", () => {
    const [file] = parseGitDiff(TWO_HUNK_DIFF)
    const split = buildSplitDiffLines(file?.hunks[0]?.lines ?? [])
    const changed = split.find(
      (row) => row.left?.type === "remove" && row.right?.type === "add"
    )

    expect(changed?.left?.content).toBe("const second = false")
    expect(changed?.right?.content).toBe("const second = true")
  })
})
