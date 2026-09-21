import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
const { buildVendorGraph, findCycles } = createRequire(import.meta.url)(
  "./vendor-chunk-graph.cjs"
)

test("detects cycles when the Vite hash contains or ends in a dash", () => {
  const graph = buildVendorGraph(
    new Map([
      [
        "vendor-ui-B-Y4SCz-.js",
        'import { x } from "./vendor-overlay-_a-b-c_d.js";',
      ],
      [
        "vendor-overlay-_a-b-c_d.js",
        'import { y } from "./vendor-ui-B-Y4SCz-.js";',
      ],
    ])
  )
  assert.equal(graph.size, 2)
  assert.equal(findCycles(graph).length, 1)
})

test("includes side-effect imports and re-exports beyond the old 4096-byte cutoff", () => {
  const graph = buildVendorGraph(
    new Map([
      [
        "vendor-a-hash.js",
        "/*" +
          "long header ".repeat(500) +
          '*/ export { x } from "./vendor-b-hash.js";',
      ],
      ["vendor-b-hash.js", 'import "./vendor-a-hash.js";'],
    ])
  )
  assert.equal(findCycles(graph).length, 1)
})

test("dynamic imports, comments and example strings do not create static cycles", () => {
  const graph = buildVendorGraph(
    new Map([
      [
        "vendor-a-hash.js",
        'import("./vendor-b-hash.js"); // import x from "./vendor-b-hash.js"\nconst example = `import x from "./vendor-b-hash.js"`;',
      ],
      ["vendor-b-hash.js", 'import "./vendor-a-hash.js";'],
    ])
  )
  assert.equal(findCycles(graph).length, 0)
})
