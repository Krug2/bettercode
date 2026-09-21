import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

test("writes deterministic SHA-256 release checksums", () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "betterc0de-checksums-"))
  try {
    const bytes = Buffer.from("installer bytes")
    fs.writeFileSync(path.join(releaseDir, "BetterC0de.exe"), bytes)
    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, "generate-release-checksums.mjs")],
      {
        env: {
          ...process.env,
          RELEASE_DIR: releaseDir,
          CHECKSUM_FILE: "SHA256SUMS-test.txt",
        },
        encoding: "utf8",
      },
    )

    assert.equal(result.status, 0, result.stderr)
    const expected = createHash("sha256").update(bytes).digest("hex")
    assert.equal(
      fs.readFileSync(path.join(releaseDir, "SHA256SUMS-test.txt"), "utf8"),
      `${expected}  BetterC0de.exe\n`,
    )
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true })
  }
})
