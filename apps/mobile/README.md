# BetterC0de Remote

The mobile workspace is the native control surface for a running BetterC0de
desktop host. It does not embed the desktop UI and it does not move provider
credentials, repositories, or chat storage onto the phone.

## Run locally

From the monorepo root:

```bash
npm ci
npm run mobile:start
```

Open the project in Expo Go or a development build. The desktop must be
running with **Settings → Remote Access** enabled. Create a pairing QR on the
desktop and scan it from the app, or enter the advertised host and one-time
code manually.

Useful commands:

```bash
npm run mobile:android
npm run mobile:ios
npm run mobile:web
npm run typecheck:mobile
npm run test:mobile
npm run export:android --workspace @betterc0de/mobile
npm run export:ios --workspace @betterc0de/mobile
npm run export:web --workspace @betterc0de/mobile
```

## Architecture

- Expo Router owns the pre-auth stack, three authenticated tabs, and the chat,
  file, and diff detail routes.
- `session-store.ts` hydrates the Keychain/Keystore profile and monitors host
  health. Web preview storage is intentionally only a development fallback.
- `remote-api.ts` is the typed Bearer-authenticated HTTP boundary.
- `remote-socket.ts` implements native in-band authentication, reconnect
  backoff, event journal replay, and duplicate suppression.
- `app-store.ts` owns thread/project hydration, optimistic sends, streams,
  pending approvals, and provider-question responses.
- File navigation always starts from `worktreePath || projectPath`; client-side
  containment checks complement the backend workspace guards.

## Network and security

Use direct HTTP only on a trusted LAN/VPN. For access outside that network,
configure the desktop's advertised custom endpoint behind HTTPS/WSS. Pairing
codes are one-use and short-lived; mobile sessions are individually visible
and revocable from the desktop. Losing a device should be followed by revoking
that device in **Paired devices**.

## Your own EAS project

The source configuration is not linked to the maintainer's Expo account or cloud project. Before running EAS cloud builds, sign in to your own Expo account, initialize/link your project using EAS, and select your own iOS and Android identifiers for distribution. Keep signing credentials and account configuration out of public commits.
