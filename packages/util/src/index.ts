// Reserved package for cross-app shared utilities.
// Currently empty — populated as we identify code that genuinely needs
// to be importable from both `apps/shell` (CommonJS) and `apps/ui` /
// `apps/backend` (ESM/TS). Until then this stub keeps the workspace
// graph stable so downstream apps can declare a workspace dep without
// getting an unresolved-package error.
export {}
