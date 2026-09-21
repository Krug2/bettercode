import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import Database from "better-sqlite3"
import { DatabaseLockedError, openDatabase, type Db } from "./db"

const tempDirs: string[] = []
const openHandles: Db[] = []
const children: ChildProcess[] = []

function tmpDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bc0de-db-lock-${label}-`))
  tempDirs.push(dir)
  return path.join(dir, "test.sqlite")
}

function track(db: Db): Db {
  openHandles.push(db)
  return db
}

/**
 * Whether a fresh connection could take the lock right now. Uses a separate
 * better-sqlite3 handle with no busy wait: SQLite arbitrates file locks
 * between connections of one process exactly as between processes, so a
 * held lock answers BUSY here too.
 */
function lockIsFree(lockPath: string): boolean {
  const probe = new Database(lockPath)
  try {
    probe.pragma("busy_timeout = 0")
    probe.exec("BEGIN IMMEDIATE")
    probe.exec("ROLLBACK")
    return true
  } catch (err) {
    if (String((err as { code?: unknown }).code).startsWith("SQLITE_BUSY")) {
      return false
    }
    throw err
  } finally {
    probe.close()
  }
}

// ── Second-process harness ─────────────────────────────────────────────────
//
// The child runs the real `openDatabase` from this file's sibling `db.ts`,
// not a re-implementation of the lock protocol. Node's type stripping loads
// the TypeScript source directly; the only edit is the `better-sqlite3`
// specifier, rewritten to an absolute path because the copy lives in a temp
// directory with no node_modules (the copy is needed because the backend
// package is CommonJS and would refuse the ESM `import` syntax in place).

let childModuleUrl = ""

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc0de-db-lock-module-"))
  tempDirs.push(dir)
  const sqliteEntry = pathToFileURL(
    createRequire(__filename).resolve("better-sqlite3")
  ).href
  const source = fs
    .readFileSync(path.join(__dirname, "db.ts"), "utf8")
    .replace('from "better-sqlite3"', `from "${sqliteEntry}"`)
  const target = path.join(dir, "db.mts")
  fs.writeFileSync(target, source)
  childModuleUrl = pathToFileURL(target).href
})

const CHILD_SCRIPT = `
const readline = require("node:readline");
import(process.env.BC0DE_LOCK_MODULE).then((m) => {
  let db = null;
  const attempt = () => {
    try {
      db = m.openDatabase(process.env.BC0DE_LOCK_DB);
      return { result: "opened", pid: process.pid };
    } catch (err) {
      if (err instanceof m.DatabaseLockedError) {
        return { result: "locked", code: err.code, message: err.message };
      }
      return { result: "error", message: String(err && err.stack || err) };
    }
  };
  const say = (line) => process.stdout.write(JSON.stringify(line) + "\\n");
  say(attempt());
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    if (line === "retry") say(attempt());
    else if (line === "close") { if (db) db.close(); db = null; say({ result: "closed" }); }
    else if (line === "exit") process.exit(0);
  });
}).catch((err) => { process.stdout.write(JSON.stringify({ result: "error", message: String(err && err.stack || err) }) + "\\n"); process.exit(2); });
`

interface ChildReply {
  result: "opened" | "locked" | "closed" | "error"
  pid?: number
  code?: string
  message?: string
}

interface LockChild {
  readonly process: ChildProcess
  readonly pid: number
  /** Resolves with the next JSON line the child prints. */
  next(): Promise<ChildReply>
  send(command: "retry" | "close" | "exit"): void
  exited(): Promise<void>
}

function spawnLockChild(dbPath: string): LockChild {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "-e", CHILD_SCRIPT],
    {
      env: {
        ...process.env,
        BC0DE_LOCK_MODULE: childModuleUrl,
        BC0DE_LOCK_DB: dbPath,
      },
      stdio: ["pipe", "pipe", "inherit"],
    }
  )
  children.push(child)
  if (typeof child.pid !== "number") throw new Error("spawn returned no pid")

  const pending: ChildReply[] = []
  const waiters: Array<(reply: ChildReply) => void> = []
  let buffered = ""
  child.stdout!.setEncoding("utf8")
  child.stdout!.on("data", (chunk: string) => {
    buffered += chunk
    let newline = buffered.indexOf("\n")
    while (newline !== -1) {
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line) {
        const reply = JSON.parse(line) as ChildReply
        const waiter = waiters.shift()
        if (waiter) waiter(reply)
        else pending.push(reply)
      }
      newline = buffered.indexOf("\n")
    }
  })
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
  })

  return {
    process: child,
    pid: child.pid,
    next: () =>
      pending.length > 0
        ? Promise.resolve(pending.shift()!)
        : new Promise((resolve) => waiters.push(resolve)),
    send: (command) => {
      child.stdin!.write(`${command}\n`)
    },
    exited: () => exited,
  }
}

afterEach(async () => {
  for (const db of openHandles.splice(0)) {
    if (db.open) db.close()
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      // Only ever the pid we captured from spawn, never one found by name.
      child.kill()
      await new Promise<void>((resolve) => child.once("exit", () => resolve()))
    }
  }
})

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("openDatabase single-writer lock", () => {
  it("closes a constructed database when setup fails before releasing its writer lock", () => {
    const dbPath = tmpDbPath("setup-failure")
    const failure = new Error("injected setup failure")
    const opened: Db[] = []
    const nativePragma = Database.prototype.pragma
    const pragma = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Db, source, options) {
      if (source === "synchronous = NORMAL") {
        opened.push(this)
        throw failure
      }
      return nativePragma.call(this, source, options)
    })
    try {
      expect(() => openDatabase(dbPath)).toThrow(failure)
      expect(opened).toHaveLength(1)
      expect(opened[0]!.open).toBe(false)
      expect(lockIsFree(`${dbPath}.lock`)).toBe(true)
    } finally {
      pragma.mockRestore()
      for (const handle of opened) if (handle.open) handle.close()
    }
    expect(track(openDatabase(dbPath)).prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
  })

  it("holds the lock file for the life of the handle and releases it on close", () => {
    const dbPath = tmpDbPath("lifecycle")
    const lockPath = `${dbPath}.lock`
    const db = track(openDatabase(dbPath))

    expect(fs.existsSync(lockPath)).toBe(true)
    expect(lockIsFree(lockPath)).toBe(false)

    db.close()
    expect(db.open).toBe(false)
    expect(lockIsFree(lockPath)).toBe(true)
    // A second close is a no-op, as before.
    expect(() => db.close()).not.toThrow()
  })

  it("lets the same process open one path twice and releases on the last close", () => {
    const dbPath = tmpDbPath("reopen")
    const lockPath = `${dbPath}.lock`
    const first = track(openDatabase(dbPath))
    const second = track(openDatabase(dbPath))

    first.close()
    expect(lockIsFree(lockPath)).toBe(false)
    expect(second.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })

    second.close()
    expect(lockIsFree(lockPath)).toBe(true)

    // Reopen after a full release works like a fresh open.
    const third = track(openDatabase(dbPath))
    expect(lockIsFree(lockPath)).toBe(false)
    third.close()
    expect(lockIsFree(lockPath)).toBe(true)
  })

  // Regression: the refcount was keyed by `path.resolve(dbPath)` verbatim,
  // and Windows callers spell the drive letter both ways (`c:\` from argv,
  // `C:\` from app.getPath). Two spellings of one file each opened their own
  // lock connection, and the second was refused by the first — the process
  // locked itself out.
  it.runIf(process.platform === "win32")(
    "shares one lock across drive-letter case variants of the same path",
    () => {
      const dbPath = tmpDbPath("casefold")
      const lockPath = `${dbPath}.lock`
      const swapped =
        dbPath[0] === dbPath[0]!.toLowerCase()
          ? dbPath[0]!.toUpperCase() + dbPath.slice(1)
          : dbPath[0]!.toLowerCase() + dbPath.slice(1)
      expect(swapped).not.toBe(dbPath)

      const first = track(openDatabase(dbPath))
      const second = track(openDatabase(swapped))
      expect(second.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })

      first.close()
      expect(lockIsFree(lockPath)).toBe(false)
      second.close()
      expect(lockIsFree(lockPath)).toBe(true)
    }
  )

  it("refuses a real second process while the first holds the lock, then admits it", async () => {
    const dbPath = tmpDbPath("second-process")
    const lockPath = `${dbPath}.lock`
    const holder = track(openDatabase(dbPath))

    const child = spawnLockChild(dbPath)
    const refused = await child.next()
    expect(refused.result).toBe("locked")
    expect(refused.code).toBe("database_locked")
    expect(refused.message).toContain("Another BetterC0de backend")
    expect(refused.message).toContain(lockPath)
    // The refusal did not disturb the holder.
    expect(holder.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
    expect(lockIsFree(lockPath)).toBe(false)

    holder.close()
    child.send("retry")
    const admitted = await child.next()
    expect(admitted).toMatchObject({ result: "opened", pid: child.pid })

    // Now the child is the holder and this process is the one refused.
    let error: unknown
    try {
      track(openDatabase(dbPath))
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(DatabaseLockedError)
    expect(error).toMatchObject({ code: "database_locked", dbPath, lockPath })

    child.send("close")
    expect(await child.next()).toEqual({ result: "closed" })
    const reopened = track(openDatabase(dbPath))
    expect(reopened.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
    child.send("exit")
    await child.exited()
  })

  it("releases the lock when the holding process is killed without cleanup", async () => {
    const dbPath = tmpDbPath("killed-holder")
    const lockPath = `${dbPath}.lock`

    const holder = spawnLockChild(dbPath)
    expect(await holder.next()).toMatchObject({ result: "opened", pid: holder.pid })

    const contender = spawnLockChild(dbPath)
    expect((await contender.next()).result).toBe("locked")
    expect(() => openDatabase(dbPath)).toThrow(DatabaseLockedError)

    // Hard kill by the pid captured from spawn: on Windows this is
    // TerminateProcess, so no exit hook in the holder gets to run. The OS
    // must drop the lock on its own.
    holder.process.kill()
    await holder.exited()

    contender.send("retry")
    expect(await contender.next()).toMatchObject({
      result: "opened",
      pid: contender.pid,
    })
    expect(() => openDatabase(dbPath)).toThrow(DatabaseLockedError)

    contender.send("close")
    expect(await contender.next()).toEqual({ result: "closed" })
    const third = track(openDatabase(dbPath))
    expect(third.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
    expect(lockIsFree(lockPath)).toBe(false)
    contender.send("exit")
    await contender.exited()
  })

  it("does not lock in-memory databases", () => {
    const db = track(openDatabase(":memory:"))
    expect(db.prepare("SELECT 1 AS one").get()).toEqual({ one: 1 })
    db.close()
  })
})
