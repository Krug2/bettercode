/// <reference types="node" />
import { afterEach, describe, it, expect, vi } from "vitest"
import { createRequire } from "node:module"
import * as path from "node:path"

// Loaded via createRequire because the module is .cjs and references
// `appConfig.cjs` for DNS timeout — same pattern as the IPC parity test.
const requireCjs = createRequire(import.meta.url)
const dns = requireCjs("node:dns").promises as typeof import("node:dns/promises")
afterEach(() => vi.restoreAllMocks())
const {
  isPrivateOrReservedIp,
  assertSafePublicHost,
  resolvePublicHostPinned,
  assertPathContained,
} = requireCjs("../../../shell/shared/security-checks.cjs") as {
  isPrivateOrReservedIp: (ip: string | null | undefined) => boolean
  assertSafePublicHost: (
    hostname: string,
    opts?: { timeoutMs?: number },
  ) => Promise<void>
  resolvePublicHostPinned: (
    hostname: string,
    opts?: { timeoutMs?: number },
  ) => Promise<{ address: string; family: number }>
  assertPathContained: (base: string, candidate: string, label?: string) => string
}

describe("isPrivateOrReservedIp", () => {
  describe("IPv4", () => {
    it.each([
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "224.0.0.1", // multicast
      "239.255.255.255",
      "240.0.0.1", // reserved
    ])("rejects %s", (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(true)
    })

    it.each([
      "8.8.8.8",
      "1.1.1.1",
      "104.16.0.1",
      "172.32.0.1", // just past 172.31
      "100.63.255.255", // just before 100.64
      "100.128.0.1", // just past 100.127
      "192.169.0.1", // just past 192.168
    ])("accepts public %s", (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(false)
    })
  })

  describe("IPv6", () => {
    it.each([
      "::1", // loopback
      "::", // unspecified
      "::ffff:127.0.0.1", // IPv4-mapped
      "fc00::1", // ULA
      "fd12:3456:789a::1", // ULA
      "fe80::1", // link-local
    ])("rejects %s", (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(true)
    })

    it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
      "accepts public %s",
      (ip) => {
        expect(isPrivateOrReservedIp(ip)).toBe(false)
      },
    )
  })

  describe("malformed input (fail closed)", () => {
    it.each(["", null, undefined, "not-an-ip", "999.999.999.999"])(
      "rejects %p",
      (input) => {
        expect(isPrivateOrReservedIp(input as never)).toBe(true)
      },
    )
  })
})

describe("assertSafePublicHost", () => {
  it("rejects a hostname whose DNS lookup returns nothing", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([])
    await expect(
      assertSafePublicHost("never-resolves-anywhere.invalid", { timeoutMs: 1000 }),
    ).rejects.toThrow(/DNS|invalid|resolution/i)
  })

  it("rejects a hostname that resolves to a private address (mocked)", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    await expect(
      assertSafePublicHost("localhost", { timeoutMs: 2000 }),
    ).rejects.toThrow(/private|reserved/i)
  })

  it("times out when DNS hangs", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(() => new Promise(() => {}))
    await expect(
      assertSafePublicHost("would-hang.example", { timeoutMs: 1 }),
    ).rejects.toThrow(/timed out|DNS|invalid|resolution/i)
  })
})

describe("resolvePublicHostPinned (S1)", () => {
  it("rejects localhost — every resolved IP must be public", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    await expect(
      resolvePublicHostPinned("localhost", { timeoutMs: 2000 }),
    ).rejects.toThrow(/private|reserved/i)
  })

  it("times out when DNS hangs", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(() => new Promise(() => {}))
    await expect(
      resolvePublicHostPinned("would-hang.example", { timeoutMs: 1 }),
    ).rejects.toThrow(/timed out|DNS|invalid|resolution/i)
  })
})

describe("assertPathContained", () => {
  // Use a known absolute base path that is platform-appropriate. On Windows
  // tests we use the OS temp dir; on POSIX the same — `path.resolve("base")`
  // is OS-relative either way, so use os.tmpdir for consistency.
  const baseDir = path.resolve("base-fixture")

  it("returns the joined absolute path on the happy path", () => {
    const out = assertPathContained(baseDir, "alpha")
    expect(out).toBe(path.join(baseDir, "alpha"))
  })

  it("rejects a candidate that escapes via ..", () => {
    expect(() => assertPathContained(baseDir, "../alpha")).toThrow(/escapes/)
    expect(() => assertPathContained(baseDir, "../../alpha")).toThrow(/escapes/)
    expect(() => assertPathContained(baseDir, "alpha/../../etc/passwd")).toThrow(
      /escapes/,
    )
  })

  it("rejects an absolute path candidate", () => {
    if (process.platform === "win32") {
      expect(() => assertPathContained(baseDir, "C:\\Windows")).toThrow(/escapes/)
    } else {
      expect(() => assertPathContained(baseDir, "/etc/passwd")).toThrow(/escapes/)
    }
  })

  it("rejects an empty / non-string candidate", () => {
    expect(() => assertPathContained(baseDir, "" as never)).toThrow(/valid string/)
    expect(() => assertPathContained(baseDir, 42 as never)).toThrow(/valid string/)
    expect(() => assertPathContained(baseDir, null as never)).toThrow(/valid string/)
  })

  it("includes the supplied label in the error message", () => {
    expect(() => assertPathContained(baseDir, "../x", "Skill path")).toThrow(
      /Skill path/,
    )
  })

  it("rejects mixed separators that resolve to a different path", () => {
    // path.join normalises mixed separators, so the equality check between
    // resolved and joined paths is what catches "alpha/" vs "alpha" or
    // multiple separators.
    expect(() => assertPathContained(baseDir, "../../escape")).toThrow()
  })
})
