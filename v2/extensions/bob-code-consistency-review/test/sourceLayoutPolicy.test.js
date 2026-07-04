const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot } = require("./helpers/sourceReader")

function readCore(fileName) {
  return fs.readFileSync(path.join(extensionRoot, "src", "core", fileName), "utf8")
}

function scanTsFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanTsFiles(fullPath, visit)
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      visit(fullPath, fs.readFileSync(fullPath, "utf8"))
    }
  }
}

test("core review types are split by domain instead of collected in one implementation file", () => {
  const expectedTypeModules = [
    "analysisTypes.ts",
    "diffTypes.ts",
    "documentTypes.ts",
    "preprocessTypes.ts",
    "reviewTypes.ts",
    "traceabilityResultTypes.ts",
    "validationTypes.ts"
  ]

  for (const fileName of expectedTypeModules) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "core", fileName)), `${fileName} must exist`)
  }

  const compatibilityShim = readCore("types.ts")
  assert.doesNotMatch(compatibilityShim, /^export type \w+\s*=/m, "types.ts must be an explicit re-export shim only")

  const sourceRoot = path.join(extensionRoot, "src")
  const legacyImports = []
  scanTsFiles(sourceRoot, (filePath, source) => {
    const relativePath = path.relative(sourceRoot, filePath).replace(/\\/g, "/")
    if (relativePath === "core/types.ts") return
    if (/from "\.\/types"|from "\.\.\/core\/types"/.test(source)) {
      legacyImports.push(relativePath)
    }
  })

  assert.deepEqual(legacyImports, [], "source files must import domain type modules directly")
})

test("traceabilityCatalog is a facade over validation, ids, types, and review-input conversion", () => {
  const source = readCore("traceabilityCatalog.ts")
  assert.match(source, /from "\.\/traceabilityIds"/)
  assert.match(source, /from "\.\/traceabilityReviewInput"/)
  assert.match(source, /from "\.\/traceabilityValidation"/)
  assert.match(source, /from "\.\/traceabilityTypes"/)
  assert.doesNotMatch(source, /\bfunction\b|const ARTIFACT_KIND|validateTraceabilityCatalog\(/)
})

test("document extraction dispatch is separated from format-specific extractors", () => {
  const analyzerRoot = path.join(extensionRoot, "src", "analyzers")
  for (const fileName of [
    "documentMarkdownExtractor.ts",
    "documentDocxExtractor.ts",
    "documentXlsxExtractor.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(analyzerRoot, fileName)), `${fileName} must exist`)
  }

  const source = fs.readFileSync(path.join(analyzerRoot, "documentExtractor.ts"), "utf8")
  assert.match(source, /from "\.\/documentMarkdownExtractor"/)
  assert.match(source, /from "\.\/documentDocxExtractor"/)
  assert.match(source, /from "\.\/documentXlsxExtractor"/)
  assert.doesNotMatch(source, /function extractMarkdownChunks|function extractDocxChunks|function extractXlsxChunks/)
  assert.doesNotMatch(source, /function htmlTableToMarkdown|function normalizeSheetRows/)
})

test("C/C++ change analysis delegates diff parsing, symbol detection, and rendering", () => {
  const analyzerRoot = path.join(extensionRoot, "src", "analyzers")
  for (const fileName of [
    "cCppDiffParser.ts",
    "cCppSymbolDetector.ts",
    "cCppAnalysisRenderer.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(analyzerRoot, fileName)), `${fileName} must exist`)
  }

  const source = fs.readFileSync(path.join(analyzerRoot, "cCppChangeAnalyzer.ts"), "utf8")
  assert.match(source, /from "\.\/cCppDiffParser"/)
  assert.match(source, /from "\.\/cCppSymbolDetector"/)
  assert.match(source, /from "\.\/cCppAnalysisRenderer"/)
  assert.doesNotMatch(source, /function parseUnifiedDiff|function detectFunctions|function renderSummary/)
})

test("extension entrypoint delegates command implementations to command modules", () => {
  const commandRoot = path.join(extensionRoot, "src", "commands")
  for (const fileName of [
    "reviewInputCommands.ts",
    "workspaceCommands.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(commandRoot, fileName)), `${fileName} must exist`)
  }

  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")
  assert.match(source, /from "\.\/commands\/reviewInputCommands"/)
  assert.match(source, /from "\.\/commands\/workspaceCommands"/)
  assert.doesNotMatch(source, /async function run(?:Create|Prepare|Apply|Repair|Explain|Initialize)/)
})
