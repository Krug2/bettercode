import path from "node:path";

export class PathSafetyError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

const WIN_RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const MAX_PATH_LEN = 2048;

/**
 * Validates an arbitrary absolute filesystem path supplied by the renderer
 * for read-only browsing. Unlike `safeResolveInside()` in `workspace.ts`,
 * this does NOT contain to a base directory — the system browser genuinely
 * needs to list arbitrary locations on the user's machine.
 *
 * Rejects:
 *  - non-string, empty, longer than {@link MAX_PATH_LEN}
 *  - NUL bytes (hard-aborts readdir on most kernels)
 *  - relative paths
 *  - Windows: `\\?\` long-path prefix, `\\.\` DOS device namespace, UNC
 *    shares (`\\server\share`)
 *  - Windows: reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
 *    in any path segment
 *  - Windows: ADS — a `:` past the drive-letter position in any segment
 *
 * Returns the normalized path (platform-appropriate separators).
 */
export function assertSafeAbsolutePath(raw: unknown, platform: NodeJS.Platform = process.platform): string {
  if (typeof raw !== "string") {
    throw new PathSafetyError("path must be a string");
  }
  if (raw.length === 0) {
    throw new PathSafetyError("path is empty");
  }
  if (raw.includes("\0")) {
    throw new PathSafetyError("path contains NUL byte");
  }

  const isWin = platform === "win32";
  const normalize = isWin ? path.win32.normalize : path.posix.normalize;
  const isAbsolute = isWin ? path.win32.isAbsolute : path.posix.isAbsolute;
  const sep = isWin ? "\\" : "/";

  if (isWin) {
    // Reject Windows namespace prefixes BEFORE normalize (normalize strips the
    // duplicate-sep signal). `\\?\`, `\\.\` and `\\server\share` all start
    // with `\\` — reject the whole class.
    if (raw.startsWith("\\\\") || raw.startsWith("//")) {
      throw new PathSafetyError("UNC and device-namespace paths are not allowed");
    }
  }

  const normalized = normalize(raw);

  if (normalized.length > MAX_PATH_LEN) {
    throw new PathSafetyError(`path exceeds ${MAX_PATH_LEN} chars`);
  }

  if (!isAbsolute(normalized)) {
    throw new PathSafetyError("path must be absolute");
  }

  if (isWin) {
    // Drive-letter prefix is the only acceptable absolute form at this point
    // (UNC is already rejected). Extract segments after the drive root.
    const driveMatch = /^[A-Za-z]:\\/.exec(normalized);
    if (!driveMatch) {
      throw new PathSafetyError("Windows path must start with a drive letter");
    }
    const afterDrive = normalized.slice(driveMatch[0].length);
    const segments = afterDrive.length === 0 ? [] : afterDrive.split(/[\\/]+/).filter(Boolean);
    for (const seg of segments) {
      // Reserved device names — case-insensitive, with optional extension
      // (e.g., `CON.txt` also hits Win32 device dispatch on many configs).
      const base = seg.split(".")[0]?.toUpperCase() ?? "";
      if (WIN_RESERVED_DEVICE_NAMES.has(base)) {
        throw new PathSafetyError(`segment '${seg}' is a reserved Windows device name`);
      }
      // ADS: `foo:bar` in a segment (colons are illegal outside the drive
      // prefix anyway; belt and suspenders).
      if (seg.includes(":")) {
        throw new PathSafetyError(`segment '${seg}' contains an alternate-data-stream colon`);
      }
    }
    // Also reject a bare drive letter segment containing reserved name
    // directly (e.g. `C:\CON`).
  }

  // Reject forward slashes on Windows unless they're the *only* separator in
  // the original raw input — mixed `\` and `/` is a classic bypass.
  if (isWin && raw.includes("/") && raw.includes("\\")) {
    throw new PathSafetyError("mixed separators not allowed on Windows");
  }

  // Strip trailing separator for consistency, except for drive roots (`C:\`)
  // and POSIX root (`/`).
  let out = normalized;
  if (out.length > 1 && out.endsWith(sep) && !(isWin && /^[A-Za-z]:\\$/.test(out))) {
    out = out.slice(0, -1);
  }
  return out;
}
