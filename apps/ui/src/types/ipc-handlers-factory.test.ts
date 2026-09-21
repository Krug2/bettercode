/// <reference types="node" />
import { describe, it, expect, vi } from "vitest"
import { createRequire } from "node:module"

// We can't load `ipc-handlers-factory.cjs` directly because its top-level
// `require("electron")` returns the electron binary path string in a Node
// environment, leaving `ipcMain` undefined. Instead we load the pure
// wrappers it exports — `makeSafeWrapper` / `makeRawWrapper` — which carry
// all of the envelope / error normalization logic without touching electron.
// `safeHandle` / `rawHandle` are thin wrappers over those + `ipcMain.handle`,
// covered by integration / smoke testing.
//
// Top-level `electron` lookup happens at require time, so we route the
// require through a stubbed module cache for the import line.
const requireCjs = createRequire(import.meta.url)

// Inject a no-op electron stub into the require cache before loading the
// factory so the destructured `ipcMain` is defined.
const electronPath = requireCjs.resolve("electron")
const cache = (
  requireCjs as unknown as {
    cache: Record<string, { id: string; filename: string; loaded: boolean; exports: unknown }>
  }
).cache
cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { ipcMain: { handle: () => {} } },
}

const { makeSafeWrapper, makeRawWrapper } = requireCjs(
  "../../../shell/shared/ipc-handlers-factory.cjs",
) as {
  makeSafeWrapper: (
    handler: (event: unknown, ...args: unknown[]) => unknown,
  ) => (event: unknown, ...args: unknown[]) => Promise<unknown>
  makeRawWrapper: (
    handler: (event: unknown, ...args: unknown[]) => unknown,
    opts?: { fallback?: unknown; warnTag?: string; channel?: string },
  ) => (event: unknown, ...args: unknown[]) => Promise<unknown>
}

describe("makeSafeWrapper", () => {
  it("wraps a plain object return in {ok: true, ...}", async () => {
    const wrapped = makeSafeWrapper(async () => ({ id: "x", name: "alpha" }))
    expect(await wrapped({})).toEqual({ ok: true, id: "x", name: "alpha" })
  })

  it("turns undefined into {ok: true}", async () => {
    const wrapped = makeSafeWrapper(async () => undefined)
    expect(await wrapped({})).toEqual({ ok: true })
  })

  it("passes through an envelope-shaped return unchanged", async () => {
    const wrapped = makeSafeWrapper(async () => ({ ok: false, error: "manual" }))
    expect(await wrapped({})).toEqual({ ok: false, error: "manual" })
  })

  it("converts a thrown Error into {ok: false, error}", async () => {
    const wrapped = makeSafeWrapper(async () => {
      throw new Error("boom")
    })
    expect(await wrapped({})).toEqual({ ok: false, error: "boom" })
  })

  it("converts a thrown string into {ok: false, error}", async () => {
    const wrapped = makeSafeWrapper(async () => {
      throw "string error"
    })
    expect(await wrapped({})).toEqual({ ok: false, error: "string error" })
  })

  it("forwards positional arguments to the handler", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true })
    const wrapped = makeSafeWrapper(inner)
    await wrapped("event-stub", { x: 1 }, "second-arg")
    expect(inner).toHaveBeenCalledWith("event-stub", { x: 1 }, "second-arg")
  })

  it("does NOT treat an array return as an envelope", async () => {
    const wrapped = makeSafeWrapper(async () => [1, 2, 3])
    const out = (await wrapped({})) as Record<string, unknown>
    expect(out.ok).toBe(true)
    expect(out["0"]).toBe(1)
  })
})

describe("makeRawWrapper", () => {
  it("passes the handler return through unchanged on success", async () => {
    const wrapped = makeRawWrapper(async () => [1, 2, 3], { fallback: [] })
    expect(await wrapped({})).toEqual([1, 2, 3])
  })

  it("returns the supplied fallback on throw", async () => {
    const wrapped = makeRawWrapper(
      async () => {
        throw new Error("disk")
      },
      { fallback: [] },
    )
    expect(await wrapped({})).toEqual([])
  })

  it("uses null as the default fallback", async () => {
    const wrapped = makeRawWrapper(async () => {
      throw new Error("disk")
    })
    expect(await wrapped({})).toBeNull()
  })

  it("supports plain-object fallbacks for *Get handlers", async () => {
    const wrapped = makeRawWrapper(
      async () => {
        throw new Error("missing")
      },
      { fallback: {} },
    )
    expect(await wrapped({})).toEqual({})
  })

  it("warns through console.warn when warnTag is set and the handler throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const wrapped = makeRawWrapper(
      async () => {
        throw new Error("boom")
      },
      { fallback: [], warnTag: "my-tag", channel: "test:list" },
    )
    await wrapped({})
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[my-tag] test:list"),
      expect.stringContaining("boom"),
    )
    warnSpy.mockRestore()
  })
})
