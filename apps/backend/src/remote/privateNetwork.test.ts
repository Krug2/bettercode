import { describe, expect, it } from "vitest"
import {
  isLoopbackHostname,
  isLoopbackIpAddress,
  isPrivateLanAddress,
} from "./privateNetwork"

describe("loopback literals", () => {
  it("accepts localhost and addresses in 127.0.0.0/8", () => {
    for (const address of [
      "127.0.0.1",
      "127.0.0.2",
      "127.255.255.254",
      "::ffff:127.0.0.1",
      "[::1]",
      "::1",
      "localhost",
    ]) {
      expect(isLoopbackHostname(address), address).toBe(true)
    }
    expect(isLoopbackIpAddress("127.0.0.2")).toBe(true)
    expect(isLoopbackIpAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isLoopbackIpAddress("localhost")).toBe(false)
  })

  it("rejects DNS names that only begin with a loopback address", () => {
    for (const name of [
      "127.0.0.1.nip.io",
      "127.0.0.1.attacker.example",
      "127.0.0.1.example.com",
      "127.evil.example",
      "127.",
      "127.0.0.1.1",
    ]) {
      expect(isLoopbackHostname(name), name).toBe(false)
      expect(isLoopbackIpAddress(name), name).toBe(false)
    }
  })
})

describe("isPrivateLanAddress", () => {
  it("accepts RFC 1918, link-local and IPv6 ULA / link-local peers", () => {
    for (const address of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.40",
      "169.254.10.10",
      "::ffff:192.168.1.40",
      "fd12:3456::1",
      // Tailscale's IPv6 range is ordinary ULA: it can only be routed to us
      // through the tunnel, so it is private either way.
      "fd7a:115c:a1e0::1",
      "fe80::1",
      "[fe80::1]",
      "fe81::1",
      "febf::1",
      "fe80::1%eth0",
    ]) {
      expect(isPrivateLanAddress(address), address).toBe(true)
    }
  })

  it("rejects public, loopback and Tailscale CGNAT peers", () => {
    for (const address of [
      "203.0.113.9",
      "198.51.100.7",
      "8.8.8.8",
      "172.32.0.1",
      "127.0.0.1",
      "::1",
      // 100.64/10 is decided by the tunnel check, never by range alone: an
      // ISP can hand it out on a physical interface shared with strangers.
      "100.70.55.96",
      "",
      "not-an-address",
      "10.0.0.1.example.com",
      "192.168.1.1garbage",
      "10.0.0.1:1234",
      "010.0.0.1",
      "fd12:garbage",
      "fe80:not-an-address",
      "ff02::1",
    ]) {
      expect(isPrivateLanAddress(address), address).toBe(false)
    }
  })
})
