const ts = require("typescript")

function isVendorChunk(file) {
  // Hashes can contain or end in '-' and '_'. Keep the whole filename as id.
  return file.startsWith("vendor-") && file.endsWith(".js")
}

function buildVendorGraph(chunks) {
  const graph = new Map()
  for (const [file, content] of chunks) {
    if (!isVendorChunk(file)) continue
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS
    )
    const deps = new Set()
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      )
        continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      const target = specifier.text.startsWith("./")
        ? specifier.text.slice(2)
        : ""
      if (chunks.has(target) && isVendorChunk(target)) deps.add(target)
    }
    graph.set(file, deps)
  }
  return graph
}

function findCycles(graph) {
  const completed = new Set()
  const active = new Set()
  const stack = []
  const cycles = []
  function visit(node) {
    if (active.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node])
      return
    }
    if (completed.has(node)) return
    active.add(node)
    stack.push(node)
    for (const dependency of graph.get(node) ?? []) visit(dependency)
    stack.pop()
    active.delete(node)
    completed.add(node)
  }
  for (const node of graph.keys()) visit(node)
  return cycles
}

module.exports = { isVendorChunk, buildVendorGraph, findCycles }
