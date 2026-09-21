/**
 * Auth credential store — separate from `settings.json`.
 *
 * Why separate?
 *   - OAuth tokens are *short-lived* and *frequently rotated* (every refresh).
 *     Co-locating them with stable user preferences invalidates the
 *     settings-watcher cache constantly.
 *   - OAuth tokens are *more sensitive* than API keys (refresh tokens grant
 *     long-term access). Keeping them in their own file with `0o600` perms
 *     and AES-256-GCM at rest is a cleaner blast-radius story.
 *   - Keeps provider auth shapes explicit, so future plugin-style auth methods
 *     can be added with minimal translation.
 *
 * Three credential shapes:
 *   - `oauth`   : access + refresh + expiry (+ optional account/enterprise)
 *   - `api`     : a bare API key (used when an OAuth provider lets the user
 *                 paste a key as a fallback; for everything else, API keys
 *                 still live in settings.providers.<id>.api_key)
 *   - `wellknown`: pre-issued opaque key+token pair
 *
 * On-disk format (after encryption):
 *   {
 *     "<provider-id>": "<encrypted-blob>",
 *     ...
 *   }
 * Each blob decrypts to a JSON-stringified Credential.
 */

import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret, getMasterKey, isEncrypted } from "../settings/crypto";
import { logger } from "../observability/logger";

export type OauthCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  /** Unix-epoch milliseconds at which `access` expires. */
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
};

export type ApiCredential = {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
};

export type WellKnownCredential = {
  type: "wellknown";
  key: string;
  token: string;
};

export type Credential = OauthCredential | ApiCredential | WellKnownCredential;

/**
 * Bounds for a single credential. Real tokens are a few KB (JWTs), never
 * tens of KB; the caps stop a hostile or buggy caller from growing
 * `auth.json` — which is read and decrypted in full on every lookup — into
 * something every provider request has to parse.
 */
const CREDENTIAL_STRING_MAX_CHARS = 16 * 1024;
const CREDENTIAL_LABEL_MAX_CHARS = 1_024;
const CREDENTIAL_METADATA_MAX_ENTRIES = 32;
const CREDENTIAL_METADATA_KEY_MAX_CHARS = 128;
const CREDENTIAL_METADATA_VALUE_MAX_CHARS = 4_096;

/** Atomic write helper — temp file + rename so a crash mid-write never
 *  truncates `auth.json`. Mirrors `settings/service.ts` semantics. */
function atomicWriteJson(targetPath: string, data: unknown): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  const json = JSON.stringify(data, null, 2);
  let cleaned = false;
  try {
    fs.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
    // `fs.renameSync` replaces an existing target on every platform Node
    // supports: POSIX rename(2) is atomic, and on Windows libuv uses
    // MoveFileEx with MOVEFILE_REPLACE_EXISTING. There is no unlink step and
    // no window in which `auth.json` is missing; a concurrent reader sees
    // either the old contents or the new ones.
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    cleaned = true;
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  } finally {
    if (!cleaned) {
      // belt+braces: if the rename succeeded but a later step throws, drop
      // the temp file too. Best-effort.
      try { fs.unlinkSync(tmp); } catch { /* already moved */ }
    }
  }
}

function readAllRaw(authPath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("auth.json root must be an object");
    }
    return parsed as Record<string, string>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    logger.error({ err, authPath }, "auth.json corrupt or unreadable — refusing access");
    throw new Error("auth.json is corrupt or unreadable", { cause: err });
  }
}

function requireEncryptionKey(): Buffer {
  const key = getMasterKey();
  if (!key) throw new Error("auth credential encryption key is unavailable");
  return key;
}

export function isValidCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  if (v.type === "oauth") {
    const c = value as Partial<OauthCredential>;
    return isBoundedSecret(c.access)
      && isBoundedSecret(c.refresh)
      && typeof c.expires === "number"
      && Number.isFinite(c.expires)
      && c.expires > 0
      && (c.accountId === undefined || isBoundedLabel(c.accountId))
      && (c.enterpriseUrl === undefined || isBoundedLabel(c.enterpriseUrl));
  }
  if (v.type === "api") {
    const c = value as Partial<ApiCredential>;
    return isBoundedSecret(c.key)
      && (c.metadata === undefined || isBoundedStringRecord(c.metadata));
  }
  if (v.type === "wellknown") {
    const c = value as Partial<WellKnownCredential>;
    return isBoundedSecret(c.key) && isBoundedSecret(c.token);
  }
  return false;
}

function isNonEmptyString(value: unknown, maxChars: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxChars;
}

function isBoundedSecret(value: unknown): value is string {
  return isNonEmptyString(value, CREDENTIAL_STRING_MAX_CHARS);
}

function isBoundedLabel(value: unknown): value is string {
  return isNonEmptyString(value, CREDENTIAL_LABEL_MAX_CHARS);
}

function isBoundedStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= CREDENTIAL_METADATA_MAX_ENTRIES
    && entries.every(
      ([key, entry]) =>
        key.length > 0
        && key.length <= CREDENTIAL_METADATA_KEY_MAX_CHARS
        && typeof entry === "string"
        && entry.length <= CREDENTIAL_METADATA_VALUE_MAX_CHARS
    );
}

function decryptCredential(blob: string): Credential | null {
  if (!isEncrypted(blob)) {
    // Pre-encryption migration path — accept plaintext on read; the next
    // write encrypts it. (Matches the same forward-compat approach
    // settings/service.ts uses for legacy rows.)
    try {
      const parsed = JSON.parse(blob);
      return isValidCredential(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  const plain = decryptSecret(blob);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain);
    return isValidCredential(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function encryptCredentialsForWrite(raw: Record<string, string>, key: Buffer): void {
  for (const [providerId, blob] of Object.entries(raw)) {
    if (typeof blob !== "string" || !decryptCredential(blob)) {
      throw new Error("auth.json is corrupt or unreadable");
    }
    // A write migrates every surviving legacy credential, not only the entry
    // being replaced. Otherwise unrelated OAuth refreshes keep copying old
    // plaintext secrets into the newly written file indefinitely.
    raw[providerId] = encryptSecret(blob, key);
  }
}

export class AuthStore {
  constructor(private readonly authPath: string) {}

  /** Returns the credential for `providerId`, or `undefined`. */
  get(providerId: string): Credential | undefined {
    const raw = readAllRaw(this.authPath);
    const blob = raw[providerId];
    if (!blob) return undefined;
    requireEncryptionKey();
    const cred = decryptCredential(blob);
    return cred ?? undefined;
  }

  /** Returns every credential keyed by provider ID. */
  all(): Record<string, Credential> {
    const raw = readAllRaw(this.authPath);
    if (Object.keys(raw).length > 0) requireEncryptionKey();
    const out: Record<string, Credential> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== "string") continue;
      const cred = decryptCredential(v);
      if (cred) out[k] = cred;
    }
    return out;
  }

  /**
   * Stores `credential` for `providerId`, replacing any prior entry.
   *
   * Read-modify-write, deliberately synchronous end to end (sync fs, sync
   * cipher): there is no await between the read and the rename, so two
   * callers in one process cannot interleave and a "lost update" mutex
   * would have nothing to guard. `auth.store.test.ts` pins this.
   */
  set(providerId: string, credential: Credential): void {
    if (!isValidCredential(credential)) throw new Error("invalid credential");
    const key = requireEncryptionKey();
    const raw = readAllRaw(this.authPath);
    encryptCredentialsForWrite(raw, key);
    const json = JSON.stringify(credential);
    raw[providerId] = encryptSecret(json, key);
    atomicWriteJson(this.authPath, raw);
  }

  /** Removes the credential for `providerId`. No-op if not present. */
  remove(providerId: string): void {
    const key = requireEncryptionKey();
    const raw = readAllRaw(this.authPath);
    encryptCredentialsForWrite(raw, key);
    if (!(providerId in raw)) return;
    delete raw[providerId];
    atomicWriteJson(this.authPath, raw);
  }

  /** True if a credential exists for the given provider. Cheap — does a single
   *  file read but skips decryption. */
  has(providerId: string): boolean {
    const raw = readAllRaw(this.authPath);
    const blob = raw[providerId];
    if (typeof blob !== "string") return false;
    requireEncryptionKey();
    return decryptCredential(blob) !== null;
  }
}
