import { afterEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { webRootCandidates } from "./http"

/**
 * `resolveWebRoot` used to live in `inProcess.ts`, one directory up; the
 * relative candidate is computed from `__dirname`, so moving the function
 * silently changed where a packaged backend looks for the renderer bundle.
 * Pin the resolved path against the repository layout instead.
 */
describe("webRootCandidates", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("resolves the relative candidate to apps/ui/dist from bootstrap/", () => {
    // apps/backend/src/bootstrap -> repo root is four levels up; the shipped
    // file sits at apps/backend/dist/bootstrap, the same depth.
    const repoRoot = path.resolve(__dirname, "../../../..")
    const candidates = webRootCandidates(undefined)
    expect(candidates[2]).toBe(path.resolve(repoRoot, "apps/ui/dist"))
    expect(candidates[3]).toBe(path.resolve(process.cwd(), "apps/ui/dist"))
  })

  it("prefers the explicit path, then the environment override", () => {
    vi.stubEnv("BETTERC0DE_WEB_ROOT", "/from-env")
    const candidates = webRootCandidates("/explicit")
    expect(candidates[0]).toBe("/explicit")
    expect(candidates[1]).toBe("/from-env")
    expect(candidates).toHaveLength(4)
  })
})
