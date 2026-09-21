#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$repo_root"

node - <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 15)) {
  console.error(`BetterC0de requires Node.js >= 22.15.0; found ${process.version}`)
  process.exit(1)
}
NODE

npm_version="$(npm --version)"
node - "$npm_version" <<'NODE'
const [major] = process.argv[2].split('.').map(Number)
if (major < 10) {
  console.error(`BetterC0de requires npm >= 10; found ${process.argv[2]}`)
  process.exit(1)
}
NODE

echo "Installing the locked dependencies..."
npm ci --no-audit --no-fund

if [[ ! -x node_modules/.bin/tsc ]]; then
  echo "The local TypeScript binary was not installed." >&2
  exit 1
fi

echo "Using local TypeScript: $(node_modules/.bin/tsc --version)"
npm run check:versions
echo "Setup complete. Start BetterC0de with: npm run dev"
