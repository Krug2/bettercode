/**
 * Shared security primitives for the Electron main process.
 *
 * These three helpers used to live in three different modules with subtly
 * different copies — onboarding-ipc / skills-ipc had their own SSRF guard,
 * skills-ipc / plugin-ipc / subagents-ipc each had their own
 * `path.resolve + startsWith` containment check. Centralising them here
 * means the security policy is in one place; if a CIDR is added or a path
 * edge case is fixed, every caller picks it up automatically.
 *
 * Three primitives:
 *
 *  - `isPrivateOrReservedIp(ip)`  — true if `ip` is in any of the
 *    private/loopback/link-local/ULA/multicast/reserved IPv4 or IPv6
 *    ranges, or anything we can't recognise (fail closed).
 *  - `assertSafePublicHost(hostname, opts?)` — DNS-resolves `hostname`
 *    and throws if any resolved address is private/reserved or DNS
 *    fails. Used before any main-process HTTPS fetch initiated by
 *    renderer-supplied URLs (skills import, future MCP fetches).
 *  - `assertPathContained(baseDir, candidate, label?)` — resolves
 *    `path.resolve(baseDir, candidate)` and throws if the result
 *    escapes `baseDir`. Used wherever a renderer-supplied id reaches
 *    `fs.cpSync` / `fs.rmSync` / `require()` (plugin install, skill
 *    delete, subagent delete).
 */

const dns = require("dns").promises
const net = require("net")
const path = require("path")
const appConfig = require("./appConfig.cjs")

// Match address bytes, not textual spelling: IPv6 zero compression, leading
// zeroes and scope IDs must not bypass the public-host boundary. Block the
// deprecated IPv4-compatible and site-local ranges alongside mapped addresses.
const nonPublicIpv6 = new net.BlockList()
nonPublicIpv6.addSubnet("::", 96, "ipv6")
nonPublicIpv6.addSubnet("::ffff:0:0", 96, "ipv6")
nonPublicIpv6.addSubnet("fc00::", 7, "ipv6")
nonPublicIpv6.addSubnet("fe80::", 10, "ipv6")
nonPublicIpv6.addSubnet("fec0::", 10, "ipv6")
nonPublicIpv6.addSubnet("ff00::", 8, "ipv6")
// Transition mechanisms can carry a private IPv4 payload (6to4 embeds it,
// Teredo and NAT64 tunnel toward it). Treat the whole prefix as non-public
// so a DNS answer cannot aim a skill import at link-local or loopback.
nonPublicIpv6.addSubnet("2002::", 16, "ipv6")
nonPublicIpv6.addSubnet("2001::", 32, "ipv6")
nonPublicIpv6.addSubnet("64:ff9b::", 96, "ipv6")
nonPublicIpv6.addSubnet("64:ff9b:1::", 48, "ipv6")
nonPublicIpv6.addSubnet("100::", 64, "ipv6")
nonPublicIpv6.addSubnet("2001:2::", 48, "ipv6")

/**
 * Reject any IP we can identify as private, reserved, link-local, ULA,
 * loopback, multicast, or unspecified — and reject anything we cannot
 * classify (fail closed).
 */
function isPrivateOrReservedIp(ip) {
  if (!ip) return true
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((o) => Number.parseInt(o, 10))
    if (parts.some((n) => Number.isNaN(n))) return true
    const [a, b] = parts
    // 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
    // 192.168/16, 224/4 (multicast), 240/4 (reserved)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  if (net.isIPv6(ip)) {
    return nonPublicIpv6.check(ip, "ipv6")
  }
  return true
}

/**
 * Resolve `hostname` via DNS and throw if any returned address is private,
 * reserved, or otherwise unsuitable for a public HTTPS fetch. Bounded by
 * a hard timeout so a slow / hostile DNS server can't hang the handler.
 *
 * The timer is cleared once the race settles either way — the original
 * implementation in skills-ipc / onboarding-ipc left it dangling, which
 * surfaced as an unhandled rejection if dns.lookup resolved first. Fixed
 * here so every consumer of the shared helper gets the corrected version.
 */
const TIMEOUT_SENTINEL = Symbol("dns-timeout")

async function assertSafePublicHost(hostname, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? appConfig.DNS_LOOKUP_TIMEOUT_MS
  let timer
  // Resolve (not reject) on timeout so that — whichever side of the race
  // wins — there is no dangling Promise rejection to leak as an unhandled
  // rejection event. The original implementation in skills-ipc /
  // onboarding-ipc had this leak; centralising the helper let us fix it
  // for every consumer at once.
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs)
  })
  let result
  try {
    result = await Promise.race([
      dns.lookup(hostname, { all: true }).catch(() => []),
      timeoutPromise,
    ])
  } finally {
    clearTimeout(timer)
  }
  if (result === TIMEOUT_SENTINEL) {
    throw new Error(`DNS lookup timed out for ${hostname}`)
  }
  const addresses = result
  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${hostname}`)
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(
        `Refusing to fetch private/reserved host ${hostname} (${address})`,
      )
    }
  }
}

/**
 * Resolve `path.resolve(baseDir, candidate)` and throw if the result is
 * outside `baseDir`. Returns the contained absolute path on success.
 *
 * `candidate` is treated as an opaque string — it must already have been
 * normalised by the caller (e.g. via `slugify` for ids, or
 * `validatePluginId` for plugin folders). This function is the second
 * line of defence; it does not by itself sanitise the input shape.
 */
function assertPathContained(baseDir, candidate, label = "path") {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${label} is not a valid string`)
  }
  const baseResolved = path.resolve(baseDir)
  const childResolved = path.resolve(baseResolved, candidate)
  if (
    childResolved !== path.join(baseResolved, candidate) ||
    !childResolved.startsWith(baseResolved + path.sep)
  ) {
    throw new Error(`${label} escapes ${baseResolved}: ${candidate}`)
  }
  return childResolved
}

/**
 * S1: resolve a hostname AND return one of the public IPs so the caller can
 * connect against the pinned IP — closing the DNS-rebind window between
 * `assertSafePublicHost` and `https.request`'s second resolution. Verifies
 * EVERY returned address is public (not just the first) so a round-robin
 * record can't slip a private IP through.
 *
 * Caller must pass the original hostname as the TLS SNI / Host header so
 * the certificate validates against the user-facing name, not the IP.
 *
 * Returns `{ address, family }`. Throws on the same conditions
 * `assertSafePublicHost` does.
 */
async function resolvePublicHostPinned(hostname, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? appConfig.DNS_LOOKUP_TIMEOUT_MS
  let timer
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs)
  })
  let result
  try {
    result = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }).catch(() => []),
      timeoutPromise,
    ])
  } finally {
    clearTimeout(timer)
  }
  if (result === TIMEOUT_SENTINEL) {
    throw new Error(`DNS lookup timed out for ${hostname}`)
  }
  const addresses = result
  if (!addresses || addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${hostname}`)
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(
        `Refusing to fetch private/reserved host ${hostname} (${address})`,
      )
    }
  }
  // Prefer the first record so traffic patterns mirror what a normal
  // resolver would do; with all addresses verified public this is safe.
  return { address: addresses[0].address, family: addresses[0].family }
}

module.exports = {
  isPrivateOrReservedIp,
  assertSafePublicHost,
  resolvePublicHostPinned,
  assertPathContained,
}
