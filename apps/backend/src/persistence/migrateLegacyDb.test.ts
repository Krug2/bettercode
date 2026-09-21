import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { openDatabase, type Db } from "./db"
import { runMigrations } from "./migrations"
import { migrateLegacyDbIfNeeded } from "./migrateLegacyDb"

const tempDirs: string[] = []
let sourceDb: Db | null = null

afterEach(() => {
  sourceDb?.close()
  sourceDb = null
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("migrateLegacyDbIfNeeded", () => {
  it("cleans up an owned marker staging file when its flush fails", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-legacy-flush-"))
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)
    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir)
    sourceDb = openDatabase(path.join(legacyDir, "betterc0de.db"))
    runMigrations(sourceDb)
    const targetPath = path.join(fakeHome, "target", "betterc0de.db")
    const originalOpen = fs.openSync
    const originalFlush = fs.fsyncSync
    let markerHandle: number | undefined
    let stagedPath: string | undefined
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      const handle = originalOpen(file, flags, mode)
      if (String(file).includes("-migration.json.tmp-")) {
        markerHandle = handle
        stagedPath = String(file)
      }
      return handle
    })
    vi.spyOn(fs, "fsyncSync").mockImplementation((handle) => {
      // Fail only the marker's own flush. Once that handle is closed the OS
      // reuses its descriptor number (the POSIX directory fsync in
      // syncDirectory is the first candidate), so a plain equality check
      // would also fail the lock release and mask the error under test.
      if (handle === markerHandle) {
        markerHandle = undefined
        throw new Error("simulated marker flush failure")
      }
      originalFlush(handle)
    })
    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow("simulated marker flush failure")
    expect(stagedPath).toBeDefined()
    expect(fs.existsSync(stagedPath!)).toBe(false)
    expect(fs.existsSync(targetPath)).toBe(false)
  })

  it("uses a consistent SQLite snapshot that includes committed WAL data", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir, { recursive: true })
    const legacyPath = path.join(legacyDir, "betterc0de.db")
    sourceDb = openDatabase(legacyPath)
    runMigrations(sourceDb)
    sourceDb.prepare(`
      INSERT INTO projection_threads
        (thread_id, project_id, created_at, updated_at)
      VALUES ('legacy-thread', 'legacy-project', ?, ?)
    `).run("2026-07-23T00:00:00.000Z", "2026-07-23T00:00:00.000Z")
    fs.writeFileSync(
      path.join(legacyDir, "settings.json"),
      JSON.stringify({ api_key: "enc:v1:legacy-ciphertext" }),
      "utf8"
    )
    fs.writeFileSync(path.join(legacyDir, "settings-key.bin"), "wrapped-key")

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    migrateLegacyDbIfNeeded(targetPath)

    const migrated = new Database(targetPath, {
      readonly: true,
      fileMustExist: true,
    })
    expect(
      migrated
        .prepare(
          "SELECT project_id FROM projection_threads WHERE thread_id = ?"
        )
        .get("legacy-thread")
    ).toEqual({ project_id: "legacy-project" })
    expect(migrated.pragma("quick_check", { simple: true })).toBe("ok")
    migrated.close()
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(targetPath), "settings.json"),
          "utf8"
        )
      )
    ).toEqual({ api_key: "enc:v1:legacy-ciphertext" })
    expect(
      fs.readFileSync(
        path.join(path.dirname(targetPath), "settings-key.bin"),
        "utf8"
      )
    ).toBe("wrapped-key")

    fs.rmSync(path.join(path.dirname(targetPath), "settings-key.bin"))
    migrateLegacyDbIfNeeded(targetPath)
    expect(
      fs.readFileSync(
        path.join(path.dirname(targetPath), "settings-key.bin"),
        "utf8"
      )
    ).toBe("wrapped-key")
  })

  it("refuses to publish the migrated database with a mismatched settings key", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-key-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir, { recursive: true })
    sourceDb = openDatabase(path.join(legacyDir, "betterc0de.db"))
    runMigrations(sourceDb)
    fs.writeFileSync(
      path.join(legacyDir, "settings.json"),
      JSON.stringify({ api_key: "enc:v1:legacy-ciphertext" }),
      "utf8"
    )
    fs.writeFileSync(path.join(legacyDir, "settings-key.bin"), "legacy-key")

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(
      path.join(path.dirname(targetPath), "settings-key.bin"),
      "different-key"
    )

    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow(
      /different target settings key/
    )
    expect(fs.existsSync(targetPath)).toBe(false)
    expect(
      fs.existsSync(path.join(path.dirname(targetPath), "settings.json"))
    ).toBe(false)
    expect(
      fs.readFileSync(
        path.join(path.dirname(targetPath), "settings-key.bin"),
        "utf8"
      )
    ).toBe("different-key")
  })

  it("fails closed when different encrypted target settings have no key", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-settings-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir, { recursive: true })
    sourceDb = openDatabase(path.join(legacyDir, "betterc0de.db"))
    runMigrations(sourceDb)
    fs.writeFileSync(
      path.join(legacyDir, "settings.json"),
      JSON.stringify({ api_key: "enc:v1:legacy-ciphertext" }),
      "utf8"
    )
    fs.writeFileSync(path.join(legacyDir, "settings-key.bin"), "legacy-key")

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const targetSettingsPath = path.join(
      path.dirname(targetPath),
      "settings.json"
    )
    fs.writeFileSync(
      targetSettingsPath,
      JSON.stringify({ api_key: "enc:v1:different-ciphertext" }),
      "utf8"
    )

    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow(
      /differ from the legacy source.*no target settings key/
    )
    expect(fs.existsSync(targetPath)).toBe(false)
    expect(fs.existsSync(path.join(path.dirname(targetPath), "settings-key.bin")))
      .toBe(false)
    expect(fs.readFileSync(targetSettingsPath, "utf8")).toContain(
      "different-ciphertext"
    )
  })

  it("restores every displaced SQLite file when companion displacement fails", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-rollback-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir, { recursive: true })
    sourceDb = openDatabase(path.join(legacyDir, "betterc0de.db"))
    runMigrations(sourceDb)
    sourceDb.close()
    sourceDb = null

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const staleTarget = new Database(targetPath)
    staleTarget.exec("CREATE TABLE stale_only (id INTEGER); DROP TABLE stale_only")
    staleTarget.close()
    const originalTargetBytes = fs.readFileSync(targetPath)
    fs.writeFileSync(`${targetPath}-wal`, "original-wal")
    fs.writeFileSync(`${targetPath}-shm`, "original-shm")

    const realRenameSync = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from) === `${targetPath}-wal`) {
        const error = Object.assign(new Error("simulated WAL displacement failure"), {
          code: "EACCES",
        })
        throw error
      }
      return realRenameSync(from, to)
    })

    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow(
      /simulated WAL displacement failure/
    )
    expect(fs.readFileSync(targetPath)).toEqual(originalTargetBytes)
    expect(fs.readFileSync(`${targetPath}-wal`, "utf8")).toBe("original-wal")
    // SQLite may initialize an existing SHM file while validating the target,
    // but the failed displacement must not strand or remove that entry.
    expect(fs.existsSync(`${targetPath}-shm`)).toBe(true)
    expect(
      fs
        .readdirSync(path.dirname(targetPath))
        .some((name) => name.includes(".pre-migration-"))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(
          path.dirname(targetPath),
          ".betterc0de-legacy-migration.json"
        )
      )
    ).toBe(true)

    renameSpy.mockRestore()
    migrateLegacyDbIfNeeded(targetPath)
    const resumed = new Database(targetPath, {
      readonly: true,
      fileMustExist: true,
    })
    expect(resumed.pragma("quick_check", { simple: true })).toBe("ok")
    resumed.close()
    expect(
      fs.existsSync(
        path.join(
          path.dirname(targetPath),
          ".betterc0de-legacy-migration.json"
        )
      )
    ).toBe(false)
  })

  it("propagates operational target inspection errors instead of replacing the database", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-operational-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, "do-not-replace")

    const realLstatSync = fs.lstatSync.bind(fs)
    vi.spyOn(fs, "lstatSync").mockImplementation((candidate, options) => {
      if (path.resolve(String(candidate)) === path.resolve(targetPath)) {
        throw Object.assign(new Error("simulated target I/O failure"), {
          code: "EIO",
        })
      }
      return realLstatSync(candidate, options as never)
    })

    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow(
      /simulated target I\/O failure/
    )
    expect(fs.readFileSync(targetPath, "utf8")).toBe("do-not-replace")
  })

  it("blocks fresh initialization when an interrupted migration loses its source", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-marker-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const legacyDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(legacyDir, { recursive: true })
    sourceDb = openDatabase(path.join(legacyDir, "betterc0de.db"))
    runMigrations(sourceDb)
    sourceDb.close()
    sourceDb = null

    const targetPath = path.join(
      fakeHome,
      "new-layout",
      "userdata",
      "betterc0de.db"
    )
    const realLinkSync = fs.linkSync.bind(fs)
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
      if (path.resolve(String(to)) === path.resolve(targetPath)) {
        throw Object.assign(new Error("simulated database publish failure"), {
          code: "EIO",
        })
      }
      return realLinkSync(from, to)
    })

    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow(
      /simulated database publish failure/
    )
    linkSpy.mockRestore()
    expect(fs.existsSync(targetPath)).toBe(false)
    expect(
      fs.existsSync(
        path.join(
          path.dirname(targetPath),
          ".betterc0de-legacy-migration.json"
        )
      )
    ).toBe(true)

    fs.rmSync(legacyDir, { recursive: true, force: true })
    expect(() => migrateLegacyDbIfNeeded(targetPath)).toThrow()
    expect(fs.existsSync(targetPath)).toBe(false)
  })

  it("does not import packaged production data into the development data root", () => {
    const fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "betterc0de-legacy-dev-isolation-home-")
    )
    tempDirs.push(fakeHome)
    vi.spyOn(os, "homedir").mockReturnValue(fakeHome)

    const productionDir = path.join(fakeHome, ".betterc0de")
    fs.mkdirSync(productionDir, { recursive: true })
    sourceDb = openDatabase(path.join(productionDir, "betterc0de.db"))
    runMigrations(sourceDb)
    sourceDb.close()
    sourceDb = null
    fs.writeFileSync(
      path.join(productionDir, "settings.json"),
      JSON.stringify({ provider_api_key: "production-secret" })
    )

    const devTarget = path.join(
      fakeHome,
      ".betterc0de-dev",
      "userdata",
      "betterc0de.db"
    )
    migrateLegacyDbIfNeeded(devTarget)

    expect(fs.existsSync(devTarget)).toBe(false)
    expect(
      fs.existsSync(path.join(path.dirname(devTarget), "settings.json"))
    ).toBe(false)
  })

  it("reclaims a stale migration lock when the recorded pid cannot be signaled", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-legacy-lock-"))
    tempDirs.push(directory)
    vi.spyOn(os, "homedir").mockReturnValue(directory)
    vi.stubEnv("APPDATA", directory)
    const targetPath = path.join(directory, ".betterc0de-dev", "userdata", "betterc0de.db")
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const lockPath = path.join(path.dirname(targetPath), ".betterc0de-legacy-migration.lock")
    const staleAt = new Date(Date.now() - 11 * 60 * 1000)
    fs.writeFileSync(lockPath, JSON.stringify({
      version: 1,
      pid: 1,
      createdAt: staleAt.getTime(),
      nonce: "stale",
    }))
    fs.utimesSync(lockPath, staleAt, staleAt)
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" })
    })
    try {
      expect(() => migrateLegacyDbIfNeeded(targetPath)).not.toThrow(/already active/)
    } finally {
      kill.mockRestore()
      vi.unstubAllEnvs()
    }
    expect(fs.existsSync(lockPath)).toBe(false)
  })
})
