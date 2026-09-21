import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

/** Trim retained journal/WAL storage after reset; this is not a live WAL cap. */
const WAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * How long a second opener waits for the lock before giving up. The lock is
 * either free or held for the life of another backend, so a long wait only
 * delays the error; this covers the few ms a dying holder needs to let go.
 */
const LOCK_BUSY_TIMEOUT_MS = 250;

/**
 * Thrown when another live process already owns the database. The backend is
 * the single writer by design: a second backend on the same file would race
 * the journal projection and the checkpoint lanes, so it must not start.
 */
export class DatabaseLockedError extends Error {
  readonly code = "database_locked";
  readonly dbPath: string;
  readonly lockPath: string;

  constructor(input: { readonly dbPath: string; readonly lockPath: string }) {
    super(
      `Another BetterC0de backend is using this data directory: ` +
        `database ${input.dbPath} is locked (lock file ${input.lockPath}). ` +
        "Stop that backend first; the lock is released automatically when it exits."
    );
    this.name = "DatabaseLockedError";
    this.dbPath = input.dbPath;
    this.lockPath = input.lockPath;
  }
}

interface HeldLock {
  readonly lockPath: string;
  readonly lockDb: Db;
  handles: number;
}

/**
 * Locks this process currently holds, keyed by resolved database path. A
 * process may open the same file more than once (tests do, and the in-process
 * shell reopens after a legacy migration); those share one lock connection
 * and it is closed when the last handle closes.
 */
const heldLocks = new Map<string, HeldLock>();

function isMemoryDatabase(dbPath: string): boolean {
  return dbPath === ":memory:" || dbPath.startsWith("file::memory:");
}

function isSqliteBusy(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return (
    typeof code === "string" &&
    (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
  );
}

/**
 * Single-writer lock next to the database file, held by the kernel rather
 * than by a pid written into a file.
 *
 * `<dbPath>.lock` is a tiny SQLite database of its own. The holder switches
 * it to `locking_mode = EXCLUSIVE`, writes one row and keeps a transaction
 * open, so the connection owns the file's EXCLUSIVE lock until it is closed
 * or its process dies. Any other process that tries the same gets
 * SQLITE_BUSY after a short wait.
 *
 * This replaces a pid-in-file scheme that was wrong on Windows: the shell
 * ends the backend with TerminateProcess so no exit hook runs, pids recycle
 * within seconds, and `process.kill(pid, 0)` reports EPERM (read as "alive")
 * for protected processes. A file lock needs none of that: the OS drops it
 * the moment the holder's handle goes away, so there is no stale-lock logic
 * and the lock file may be left on disk between runs.
 *
 * Returns the release function for this handle.
 */
function acquireDatabaseLock(dbPath: string): () => void {
  if (isMemoryDatabase(dbPath)) return () => {};
  const resolved = path.resolve(dbPath);
  // Windows paths are case-insensitive but `path.resolve` keeps the case it
  // was given, and callers do not agree on the drive letter (`c:\` from an
  // argv, `C:\` from `app.getPath`). Two spellings of one file must share
  // one refcounted lock connection: keyed apart, the second open tried to
  // take the EXCLUSIVE lock the first already held and this process locked
  // itself out with DatabaseLockedError.
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const lockPath = `${resolved}.lock`;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const held = heldLocks.get(key);
    if (!held) return;
    held.handles -= 1;
    if (held.handles > 0) return;
    heldLocks.delete(key);
    // Closing rolls the open transaction back and drops the file lock.
    held.lockDb.close();
  };

  const existing = heldLocks.get(key);
  if (existing) {
    existing.handles += 1;
    return release;
  }

  const lockDb = new Database(lockPath);
  try {
    lockDb.pragma(`busy_timeout = ${LOCK_BUSY_TIMEOUT_MS}`);
    lockDb.pragma("locking_mode = EXCLUSIVE");
    // The first write takes the EXCLUSIVE lock and, in this locking mode, the
    // connection never gives it back. Committing makes the holder row visible
    // for diagnostics; the transaction reopened afterwards is belt and braces
    // so the lock is still held even if a future SQLite relaxed that rule.
    lockDb.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS holder (pid INTEGER NOT NULL, opened_at TEXT NOT NULL);
      DELETE FROM holder;
      INSERT INTO holder (pid, opened_at) VALUES (${process.pid}, '${new Date().toISOString()}');
      COMMIT;
      BEGIN IMMEDIATE;
    `);
  } catch (err) {
    try {
      lockDb.close();
    } catch {
      // The failed handle is discarded either way.
    }
    if (isSqliteBusy(err)) {
      throw new DatabaseLockedError({ dbPath, lockPath });
    }
    throw err;
  }
  heldLocks.set(key, { lockPath, lockDb, handles: 1 });
  return release;
}

/**
 * Opens (or creates) the SQLite database file, ensures the parent directory
 * exists, and applies the same PRAGMAs the Rust backend used so the two
 * implementations read/write the file identically during parallel-run.
 *
 * `auto_vacuum = INCREMENTAL` is a no-op on databases that were already
 * created without auto_vacuum — SQLite only honours it before the first
 * table is created.  Fresh installs pick it up; upgraders keep their
 * existing vacuum mode until `VACUUM` is run manually. The journal size limit
 * trims retained storage after reset/checkpoint; a long-lived reader can still
 * prevent checkpoint completion and allow the active WAL to grow.
 *
 * The handle holds the single-writer lock (see acquireDatabaseLock) until
 * `close()`, which also runs `PRAGMA optimize` so planner statistics are
 * refreshed at the cheapest possible moment.
 *
 * Equivalent to rust-backend/src/persistence/sqlite.rs:open_database.
 */
export function openDatabase(dbPath: string): Db {
  if (!isMemoryDatabase(dbPath)) {
    const parent = path.dirname(dbPath);
    fs.mkdirSync(parent, { recursive: true });
  }
  const releaseLock = acquireDatabaseLock(dbPath);

  let db: Db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    releaseLock();
    throw err;
  }
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    // Only the journal lane retries SQLITE_BUSY on its own; every HTTP write
    // path (thread saves, truncation, checkpoint stores) is a bare synchronous
    // statement that would surface a 25 ms BUSY as a 500 and lose the write.
    // On Windows, Defender or the search indexer routinely hold the -wal/-shm
    // files for a few hundred ms, so keep the generous wait.
    db.pragma("busy_timeout = 5000");
    db.pragma("cache_size = -8000");
    db.pragma("mmap_size = 67108864");
    db.pragma("temp_store = MEMORY");
    db.pragma("auto_vacuum = INCREMENTAL");
    db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);
    db.pragma("wal_autocheckpoint = 1000");
  } catch (err) {
    // Setup can fail after native construction. Close this handle before
    // releasing the writer lock so a retry never overlaps an orphaned opener.
    try {
      db.close();
    } catch (cleanupError) {
      throw new AggregateError([err, cleanupError], "Database setup and cleanup failed");
    }
    releaseLock();
    throw err;
  }

  const nativeClose = db.close.bind(db);
  db.close = function close(this: Db) {
    if (db.open) {
      try {
        // Cheap when nothing changed; SQLite recommends it right before close
        // so the stat tables reflect the indexes the session actually used.
        db.pragma("optimize");
      } catch {
        // Statistics are an optimisation; a failure must never block close.
      }
    }
    const result = nativeClose();
    releaseLock();
    return result;
  } as Db["close"];
  return db;
}

/**
 * Reclaims free pages from the database file after large deletions.  Safe
 * to call while other connections are active — SQLite just compacts what
 * it can and leaves the rest for a later call.  Intended to be invoked by
 * the optional maintenance timer configured during backend bootstrap.
 */
export function incrementalVacuum(db: Db, pages = 1000): void {
  try {
    db.pragma(`incremental_vacuum(${pages})`);
  } catch {
    // incremental_vacuum is a no-op when auto_vacuum isn't enabled on the
    // existing file — that's fine, treat it as best-effort maintenance.
  }
}
