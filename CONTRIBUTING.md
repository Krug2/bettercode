# Contributing to BetterC0de

Thanks for helping improve BetterC0de. Start with the [development guide](docs/development/README.md) and the [architecture overview](docs/architecture/overview.md).

## Before you start

Search the [issues](https://github.com/kerim0x1/bettercode/issues) for existing reports. For a substantial feature or architectural change, describe the problem and proposed approach in an issue before implementing it. Small, focused fixes can go straight to a pull request.

Check [license status](docs/open-source-readiness.md) before contributing or redistributing the project. Third-party dependencies and assets retain their own terms.

## Local workflow

1. Fork the repository and create a branch for one change.
2. Follow the development guide to install dependencies and start the app.
3. Keep changes focused and preserve existing behavior outside the task.
4. Add or update tests when behavior changes. Use the existing suite for the affected area.
5. Run `npm run verify:source` and `npm run build` before opening a pull request.

Use npm and commit any intentional dependency changes together with `package-lock.json`. Do not commit dependency folders, generated bundles, signing certificates, local settings, database files, or real provider credentials.

## Project conventions

- Keep renderer backend access behind the existing service/transport layer.
- Keep public contracts in `packages/schema` and mirror IPC changes in both registries where required.
- Follow existing TypeScript, React, and CommonJS conventions in the files you edit.
- Use the project's dialogs and permission flows for user decisions.
- Keep provider-specific behavior in the appropriate provider adapter.
- Update user-facing documentation when setup, behavior, or diagnostics change.

## Pull requests

Explain the problem, the resulting behavior, and how you checked it. Include screenshots for visible UI changes and note any platform you could not test. Avoid unrelated formatting changes or dependency upgrades.

Keep discussion respectful and focused on the work. For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue with exploit details.
