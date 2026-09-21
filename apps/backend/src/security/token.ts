import crypto from "node:crypto";

/**
 * Generates a 32-byte bearer token (64 hex chars) for HTTP + WS auth.
 * Equivalent to rust-backend/src/security/mod.rs:generate_token (which used
 * uuid::v4 but with less entropy — this raises that to 256 bits).
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Constant-time string comparison, used to validate the Bearer token
 * without leaking timing information about the expected value.
 * Equivalent to the rust-backend subtle::ConstantTimeEq usage.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Compare against a same-length decoy so the mismatch itself is constant-time.
    // The length mismatch is already leaked by the returned false, which is
    // acceptable — we only need the byte-comparison to be constant-time.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
