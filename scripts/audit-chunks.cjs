// Post-build audit for the Rollup vendor chunks. Catches the class of
// bug that has crashed production three times now:
//
//   1. A `vendor-X` chunk imports another `vendor-Y` chunk at module top
//      level (cross-chunk static import = potential cycle target).
//   2. A `vendor-X` and `vendor-Y` chunk both import each other → cycle.
//      ESM evaluates these bindings in TDZ until both finish, surfacing
//      at runtime as "Cannot access 'X' before initialization" or
//      "Cannot read properties of undefined (reading '...')".
//
// The audit reads every `dist/assets/vendor-*.js` chunk, parses the
// top-level `import { … } from "./other-chunk.js"` lines, and:
//   • prints the cross-chunk dependency graph (informational)
//   • errors + exits non-zero if a cycle exists
//
// Intentionally restricted to vendor-* chunks because those are the only
// ones we manually route via `manualChunks` in vite.config.ts — Rollup's
// auto-chunked pages/lazy-loaded modules handle their own cycles.
const fs = require("fs")
const path = require("path")
const {
  isVendorChunk,
  buildVendorGraph,
  findCycles,
} = require("./vendor-chunk-graph.cjs")

// After the apps/ migration the renderer's Vite output lives at
// `apps/ui/dist/`. The script still runs from `scripts/` at the repo
// root, so we walk up one and dive into apps/ui/dist/assets.
const distAssets = path.join(__dirname, "..", "apps", "ui", "dist", "assets")
if (!fs.existsSync(distAssets)) {
  console.error(
    "[chunks-audit] apps/ui/dist/assets does not exist — run `npm run build` first"
  )
  process.exit(2)
}

const chunkFiles = fs.readdirSync(distAssets).filter(isVendorChunk)
if (chunkFiles.length === 0) {
  console.error(
    "[chunks-audit] no vendor chunks found; refusing an empty audit"
  )
  process.exit(2)
}
const graph = buildVendorGraph(
  new Map(
    chunkFiles.map((file) => [
      file,
      fs.readFileSync(path.join(distAssets, file), "utf8"),
    ])
  )
)
const cycles = findCycles(graph)

// Pretty-print the graph
console.log("[chunks-audit] vendor-chunk dependency graph:")
const sortedKeys = [...graph.keys()].sort()
for (const k of sortedKeys) {
  const deps = [...graph.get(k)].sort()
  console.log("  " + k + (deps.length ? "  →  " + deps.join(", ") : "  (leaf)"))
}

if (cycles.length > 0) {
  console.error("\n[chunks-audit] ✗ FOUND " + cycles.length + " CYCLE(S):")
  // Dedupe cycles (same cycle, different starting node)
  const seen = new Set()
  for (const cyc of cycles) {
    const key = [...cyc].sort().join("|")
    if (seen.has(key)) continue
    seen.add(key)
    console.error("    " + cyc.join(" → "))
  }
  console.error(
    "\n[chunks-audit] Cycles between manually-routed vendor chunks cause TDZ\n" +
      "  errors at runtime. Fix by merging the cycle members into the same\n" +
      "  chunk in vite.config.ts (VENDOR_CHUNK_MAP), or by tightening a regex\n" +
      "  matcher that's accidentally catching a foreign package."
  )
  process.exit(1)
}

console.log("\n[chunks-audit] ✓ no cycles between vendor chunks")
