import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for secrets stored in settings.json (provider API keys
 * in particular).  The master key is provisioned by the Electron main
 * process via `safeStorage` and handed to this backend through the
 * `BETTERC0DE_SETTINGS_KEY` environment variable (base64-encoded 32 bytes).
 *
 * Ciphertext format on disk: `enc:v1:<base64(iv || tag || ciphertext)>`
 * using AES-256-GCM with a 96-bit IV and 128-bit auth tag.  The version
 * prefix lets future rotations coexist with already-written blobs.
 *
 * When no key is available (tests, CLI-only environments, or safeStorage
 * unsupported on Linux without a compatible keyring) the helpers degrade
 * gracefully: encryption becomes a no-op and plaintext continues to round-
 * trip.  This keeps the pre-encryption behaviour working for anyone
 * upgrading, while fresh installs in Electron get encrypted storage from
 * the first write.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null | undefined;

/** Returns the 32-byte master key, or null if encryption is unconfigured. */
export function getMasterKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const b64 = process.env.BETTERC0DE_SETTINGS_KEY;
  delete process.env.BETTERC0DE_SETTINGS_KEY;
  if (!b64) {
    cachedKey = null;
    return null;
  }
  try {
    const key = Buffer.from(b64, "base64");
    cachedKey = key.length === KEY_LEN ? key : null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

/** Reset the cached key — test hook only. */
export function __resetMasterKeyCache(): void {
  cachedKey = undefined;
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt `plaintext` with the active master key.  Returns the input
 * unchanged when no key is available so existing plaintext round-trips
 * without loss; callers that require encryption must check {@link getMasterKey}
 * first.  Also returns the input unchanged if it is already encrypted
 * (idempotent over repeated persists).
 */
export function encryptSecret(plaintext: string, key: Buffer | null = getMasterKey()): string {
  if (!key) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a value written by {@link encryptSecret}.  Returns plaintext for
 * unencrypted strings (read-time passthrough for legacy settings files) or
 * `null` when decryption fails — corrupt ciphertext, wrong key (user moved
 * machines), or missing key on a file that was encrypted previously.
 */
export function decryptSecret(value: string, key: Buffer | null = getMasterKey()): string | null {
  if (!isEncrypted(value)) return value;
  if (!key) return null;
  try {
    const payload = Buffer.from(value.slice(PREFIX.length), "base64");
    if (payload.length < IV_LEN + TAG_LEN) return null;
    const iv = payload.subarray(0, IV_LEN);
    const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = payload.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
