# Dependency security review

Checked on 2026-09-21 using `npm audit --omit=dev --package-lock-only` across the npm workspace lockfile. This includes the mobile workspace; it is not an inventory of only the shipped desktop runtime.

## Changes made during source preparation

Compatible updates were applied to the locked dependency graph, including `tar` 7.5.22, DOMPurify 3.4.15, Hono 4.13.8, the Hono Node adapter 1.19.17, and electron-updater 6.8.9. Supporting packages were also updated within their declared ranges.

Metro, metro-config, and metro-transform-worker are overridden to 0.84.5 together. This aligns the React Native tooling with the patched version used by `@expo/metro`; keeping the set aligned avoids retaining the older 0.84.4 dependency cycle. Revisit these overrides when upgrading Expo or React Native.

The audit initially reported 36 affected package entries, including one critical and 16 high entries. After these changes it reports **13 moderate entries, zero high, and zero critical**. These are npm's severity classifications, not an independent finding that every affected code path is reachable in BetterC0de.

## Remaining advisories

| Underlying dependency | Advisory | Why it remains |
| --- | --- | --- |
| `decode-uri-component`, through query-string and Expo tooling | [Malformed percent-encoded input can cause excessive decoding work](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | The registry had no patched 0.4.3 release at review time. npm proposes changing the Expo Router major version. Replacing the decoder or changing the mobile stack requires a separate compatibility change. |
| `uuid`, through xcode and Expo configuration tooling | [Missing buffer bounds checks in selected UUID generators](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | xcode requests uuid 7.x. A fixed version would require overriding its major dependency or changing the upstream toolchain. The inspected xcode call uses `v4()` without an output buffer, rather than the affected generators, but the advisory remains in the dependency graph. |

The other moderate package entries are dependents of these two chains. No forced Expo downgrade or unverified major override was applied to make the audit output green. Keep these findings visible until the upstream dependencies can be updated or a tested replacement is introduced.

## Recheck

Run `npm audit --omit=dev` after dependency changes and before a release. Use the development guide's source and build checks after updating the lockfile, and test the mobile toolchain when changing Expo or Metro. New advisories may appear after the date of this review.
