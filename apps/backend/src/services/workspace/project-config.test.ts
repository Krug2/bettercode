import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  __resetProjectConfigCrawlCachesForTests,
  betterC0deProjectConfigFileSources,
} from "./project-config"
import { listProjectConfigSettings } from "./settings"

const tempRoots: string[] = []

function makeTree(): { outer: string; inner: string } {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-gitroot-"))
  tempRoots.push(outer)
  const inner = path.join(outer, "inner")
  fs.mkdirSync(inner)
  return { outer, inner }
}

/** Directories whose top-level config files are consulted, nearest last. */
function crawledDirectories(workspaceRoot: string): string[] {
  return betterC0deProjectConfigFileSources(workspaceRoot, ["betterc0de.json"]).map(
    (source) => path.dirname(source.absolutePath)
  )
}

describe("project config ancestor crawl", () => {
  beforeEach(() => {
    __resetProjectConfigCrawlCachesForTests()
  })

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it("stops the crawl at the nearest git root above the workspace", () => {
    const { outer, inner } = makeTree()
    fs.mkdirSync(path.join(outer, ".git"))
    expect(crawledDirectories(inner)).toEqual([outer, inner])
  })

  it("keeps arbitrary config keys as string labels", async () => {
    const { inner } = makeTree()
    fs.writeFileSync(path.join(inner, "betterc0de.json"), '{"constructor":true,"__proto__":false}')
    const settings = await listProjectConfigSettings(inner)
    for (const key of ["constructor", "__proto__"]) {
      expect(settings.find((entry) => entry.key === key)?.label).toBe(key)
    }
  })

  // Regression: the git-root lookup was cached on the workspace root itself,
  // so `git init` inside an open workspace kept resolving to the ancestor
  // repository for 30 s and its config files kept being read.
  it("sees a .git created in the workspace root immediately", () => {
    const { outer, inner } = makeTree()
    fs.mkdirSync(path.join(outer, ".git"))
    expect(crawledDirectories(inner)).toEqual([outer, inner])

    fs.mkdirSync(path.join(inner, ".git"))
    expect(crawledDirectories(inner)).toEqual([inner])

    // And the reverse: removing it falls back to the ancestor walk.
    fs.rmSync(path.join(inner, ".git"), { recursive: true, force: true })
    expect(crawledDirectories(inner)).toEqual([outer, inner])
  })
})
