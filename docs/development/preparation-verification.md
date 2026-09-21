# Source preparation verification

Verified locally on Windows with Node.js 22.15.0 on 2026-09-21.

## Source and repository preparation

The application source snapshot contains 3,059 copied files, including the desktop shell, renderer, backend, mobile app, shared packages, scripts, tests, and optional Remotion compositions. All selected source paths were compared with the original working tree; none are missing. Differences are limited to the documented preparation changes and fixes.

Existing branding, guides, and repository history were retained. The private development repository's Git history was not imported. Installed dependencies and generated output are ignored by Git. No staging, commit, push, release publication, or repository visibility change was performed by this preparation process.

The publishable file list was checked for local tooling state, dependency directories, build output, runtime databases, environment secrets, and signing-key filenames. A content scan found no matches for the tested common credential formats, private-key headers, or original machine-specific user paths. This pattern scan is not a guarantee that every possible secret format has been detected.

Local Markdown file links resolve, YAML files parse, and all local platform packaging scripts explicitly use `--publish never`.

## Verification results

| Check | Result |
| --- | --- |
| Fresh `npm ci --no-audit --no-fund` | Passed, including the Node-native SQLite rebuild. |
| `npm run verify:source` | Passed: workspace versions, backend/schema build, desktop/backend/mobile/demo typechecks, lint, and all included suites. |
| Packaging and shell tests | 141 passed. |
| Renderer tests | 2,361 passed. |
| Backend tests | 2,905 passed; 4 skipped by the existing suite. |
| Mobile tests | 77 passed. |
| `npm run build` | Passed; frontend chunk-cycle and configured size-budget checks passed. |
| `npm run perf:backend` | Passed: 807 ms startup and 164.6 MB RSS on this machine. |
| Mobile web export | Passed with the patched Metro dependency set and shared-schema import. |
| `npm run typecheck:remotion` | Optional check; skips cleanly when the Git-ignored local `remotion/` project is absent. |
| Electron main/preload syntax and compiled schema loading | Passed. |
| Dependency audit | Zero critical/high entries; 13 moderate affected-package entries from two advisory chains remain documented. |

Total: **5,484 passing tests and 4 skipped tests**.

## Limits and remaining decisions

These are source, bundle, and backend-startup checks. Native macOS/Linux installers, mobile device builds, signing, update delivery, and real provider-account interactions were not revalidated as part of this source preparation.

npm reports an existing optional peer-version warning involving Expo modules and React Native Worklets. Typechecks, mobile tests, and the web export pass; those checks do not establish native iOS/Android compatibility. Review the mobile dependency set before a native release.

Vite reports large chunks, while the project's explicit bundle-size and cycle gates pass. Remaining dependency advisories are described in the [dependency review](dependency-security.md).

MIT is now selected for BetterC0de source and recorded in the root `LICENSE` file and package metadata. Asset provenance and third-party usage terms still need the owner review described in [third-party notices](../../THIRD_PARTY_NOTICES.md); those materials are not relicensed by the MIT choice.

## Diagnostic listener follow-up

The deprecated Electron console-message listener was updated to the event-object API after a native Electron probe reproduced the warning. The probe still captured renderer logs after the change and no longer emitted the warning. The 30 existing diagnostics, heartbeat, device-info and report tests pass again in this prepared checkout. The collector comment now explicitly includes manual and automatic reports.
