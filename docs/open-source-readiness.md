# Public-source preparation

This checkout contains the BetterC0de application source, tests, development tools, mobile companion, and demo compositions. The source release date is 21 September 2026.

See the [verification record](development/preparation-verification.md) for completed checks, results, and platform limits.

## Prepared

- [x] Preserve the branded README, website image, and user guides.
- [x] Copy application and workspace source without importing the private repository's Git history.
- [x] Include build scripts, lockfile, tests, and CI/release workflows.
- [x] Point package and release metadata to `kerim0x1/bettercode`.
- [x] Make local packaging commands explicitly avoid publishing.
- [x] Document development, contributions, diagnostics, and vulnerability reporting.
- [x] Exclude machine-local settings, credentials, caches, runtime databases, and build output.
- [x] Remove the original Expo account/project binding from the mobile app configuration.
- [x] Disable automatic diagnostic requests in CI jobs.
- [x] Fix the verification order so a fresh checkout builds the backend before packaging tests.
- [x] Apply compatible dependency security updates; record remaining advisories in the [dependency review](development/dependency-security.md).
- [x] Correct stale demo fixture imports and state fields; include demo typechecking in the source gate.
- [x] Correct the shared-schema import used by Metro; include a mobile web export in CI.
- [x] Preserve the upstream sound and font license texts and record audio provenance.

## Publication record

- [x] MIT selected for BetterC0de source; the full text is in [`LICENSE`](../LICENSE), and package metadata declares `MIT`. This license applies to project source only; third-party terms remain separate.
- [x] Product images are the owner's: the logo, `apps/ui/public/background.webp`, and `assets/betterc0de-website.png`. Integration icons in `apps/ui/public/icons` remain third-party marks. See [third-party notices](../THIRD_PARTY_NOTICES.md).
- [x] Anthropic's Claude Agent SDK and optional Remotion tooling keep their own terms. Those terms are named in the third-party notices and are not replaced by MIT.
- [x] The two remaining moderate advisory chains are recorded in the [dependency review](development/dependency-security.md). They do not block the beta source release. Re-check them before a packaged release.
- [x] `SECURITY.md` tells reporters to use GitHub private vulnerability reporting. Enable that control in the repository Security tab if it is not already on, and keep Actions permissions limited to the workflows in `.github/workflows`.

No dependency or third-party asset is relicensed by choosing a license for BetterC0de's own source. Keep the relevant notices in redistributed source and binaries.
