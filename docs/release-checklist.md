# Public Beta Release Checklist

BetterC0de releases are built from a `v<package-version>` tag. The root app,
all workspaces, and `package-lock.json` must share the same version.

## Before tagging

1. Run `npm ci --no-audit --no-fund` from the repository root.
2. Run `npm run verify:source`.
3. Run `npm run build` and `npm run perf:backend`.
4. Review `npm audit --omit=dev` and document any accepted advisory.
5. Confirm the intended version with `npm run check:versions`.
6. Update release notes with user-visible changes, migrations, and known risks.

## Tag and publish

1. Create the tag `v<package-version>`.
2. Push the tag. The release workflow verifies source once on Linux, then
   builds and startup-smokes native packages on macOS x64/arm64, Windows x64,
   and Linux x64.
3. Do not publish artifacts when any platform smoke, size budget, startup
   budget, or tag/version contract fails.

## After publishing

1. Install one artifact on each supported operating system.
2. Verify launch, provider discovery, one streamed turn, approval handling,
   resume, and update metadata.
3. Record rollback instructions and any verification gap in the release notes.
