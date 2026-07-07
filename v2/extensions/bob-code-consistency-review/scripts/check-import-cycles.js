#!/usr/bin/env node
"use strict"

const fs = require("node:fs")
const { createRequire } = require("node:module")
const path = require("node:path")

function loadTypeScript() {
  const packageRequire = createRequire(path.join(process.cwd(), "package.json"))
  return packageRequire("typescript")
}

function parseArgs(argv) {
  if (argv.length !== 1) {
    throw new Error("Usage: check-import-cycles.js <source-root>")
  }
  return path.resolve(process.cwd(), argv[0])
}

function normalizePath(filePath) {
  return path.normalize(path.resolve(filePath))
}

function toDisplayPath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/")
}

function collectTypeScriptFiles(root) {
  const files = []
  const pending = [root]

  while (pending.length > 0) {
    const current = pending.pop()
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        pending.push(path.join(current, entry.name))
      }
      continue
    }
    if (stat.isFile() && /\.(ts|tsx)$/.test(current) && !/\.d\.ts$/.test(current)) {
      files.push(normalizePath(current))
    }
  }

  return files.sort()
}

function getStringLiteralText(ts, node) {
  if (node && ts.isStringLiteralLike(node)) {
    return node.text
  }
  return undefined
}

function collectModuleSpecifiers(ts, sourceFile) {
  const specifiers = []

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = getStringLiteralText(ts, node.moduleSpecifier)
      if (specifier) {
        specifiers.push(specifier)
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = getStringLiteralText(ts, node.moduleReference.expression)
      if (specifier) {
        specifiers.push(specifier)
      }
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [argument] = node.arguments
      const specifier = getStringLiteralText(ts, argument)
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (specifier && (isDynamicImport || isRequire)) {
        specifiers.push(specifier)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function candidateFiles(basePath) {
  const extension = path.extname(basePath)
  if (extension) {
    const withoutExtension = basePath.slice(0, -extension.length)
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
      return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`, basePath]
    }
    return [basePath]
  }

  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx")
  ]
}

function resolveRelativeImport(sourceFile, specifier, fileSet) {
  if (!specifier.startsWith(".")) {
    return undefined
  }

  const basePath = path.resolve(path.dirname(sourceFile), specifier)
  for (const candidate of candidateFiles(basePath)) {
    const normalized = normalizePath(candidate)
    if (fileSet.has(normalized)) {
      return normalized
    }
  }

  return undefined
}

function buildGraph(ts, root, files) {
  const fileSet = new Set(files)
  const graph = new Map()

  for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8")
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)
    const dependencies = []

    for (const specifier of collectModuleSpecifiers(ts, sourceFile)) {
      const resolved = resolveRelativeImport(file, specifier, fileSet)
      if (resolved && resolved.startsWith(root)) {
        dependencies.push(resolved)
      }
    }

    graph.set(file, [...new Set(dependencies)].sort())
  }

  return graph
}

function findImportCycles(graph) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  const cycles = []
  const seen = new Set()

  function visit(file) {
    visiting.add(file)
    stack.push(file)

    for (const dependency of graph.get(file) ?? []) {
      if (visiting.has(dependency)) {
        const cycleStart = stack.indexOf(dependency)
        const cycle = stack.slice(cycleStart).concat(dependency)
        const key = cycle.join("\0")
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(cycle)
        }
      } else if (!visited.has(dependency)) {
        visit(dependency)
      }
    }

    stack.pop()
    visiting.delete(file)
    visited.add(file)
  }

  for (const file of [...graph.keys()].sort()) {
    if (!visited.has(file)) {
      visit(file)
    }
  }

  return cycles
}

function main() {
  const root = normalizePath(parseArgs(process.argv.slice(2)))
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Source root does not exist or is not a directory: ${root}`)
  }

  const ts = loadTypeScript()
  const files = collectTypeScriptFiles(root)
  const graph = buildGraph(ts, root, files)
  const cycles = findImportCycles(graph)

  if (cycles.length > 0) {
    for (const cycle of cycles) {
      console.error(`Import cycle: ${cycle.map((file) => toDisplayPath(root, file)).join(" -> ")}`)
    }
    process.exit(1)
  }

  console.log(`Import cycle policy OK: ${files.length} TypeScript files checked`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
