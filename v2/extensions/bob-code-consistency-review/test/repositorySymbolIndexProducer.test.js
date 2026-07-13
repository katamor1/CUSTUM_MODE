const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { preprocessReview } = require("../out/core/pipeline")
const { createMultiLanguageGitReviewWorkspace } = require("./helpers/reviewPipelineFixtures")

const INDEX_PATH = ".bob/evidence-scope/repository-symbol-index.json"
const CACHE_PATH = ".bob/evidence-scope/repository-symbol-index.cache.json"

function producerApi() {
  return require("../out/evidenceScope/repositorySymbolIndexProducer")
}

function publicApi() {
  return require("../out/evidenceScope")
}

test("repository index producer emits deterministic stable symbols and repository relationships", async () => {
  const workspace = createProducerWorkspace()
  const revision = head(workspace)
  const { produceRepositorySymbolIndex } = producerApi()

  const first = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH,
    maxFiles: 100,
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 1024 * 1024
  })

  assert.equal(first.cacheStatus, "miss")
  assert.equal(first.scannedFiles, 3)
  assert.equal(first.rebuiltFiles, 3)
  assert.equal(first.reusedFiles, 0)
  assert.equal(first.removedFiles, 0)
  assert.match(first.contentHash, /^sha256:[0-9a-f]{64}$/)

  const indexFile = path.join(workspace, INDEX_PATH)
  const firstBytes = fs.readFileSync(indexFile)
  const index = JSON.parse(firstBytes.toString("utf8"))
  assert.equal(index.schema_version, 1)
  assert.equal(index.index.id, "bob-repository-index")
  assert.equal(index.index.source_revision, revision)
  assert.equal(index.index.generator, "bob-code-consistency-review/repository-index-producer-v1")
  assert.deepEqual(index.symbols.map((item) => item.id), [...index.symbols.map((item) => item.id)].sort())
  assert.deepEqual(index.edges.map(edgeIdentity), [...index.edges.map(edgeIdentity)].sort())

  assert.ok(index.symbols.some((item) => item.id === "function:src/api.ts#api" && item.kind === "function"))
  assert.ok(index.symbols.some((item) => item.id === "type:src/api.ts#Request" && item.kind === "type"))
  assert.ok(index.symbols.some((item) => item.id === "function:src/helper.ts#helper"))
  assert.ok(index.symbols.some((item) => item.id === "file:test/api.test.ts" && item.is_test === true))
  assert.ok(index.edges.some((item) => item.from === "file:test/api.test.ts" && item.to === "file:src/api.ts" && item.kind === "tests"))
  assert.ok(index.edges.some((item) => item.from === "file:src/api.ts" && item.to === "function:src/helper.ts#helper" && item.kind === "calls"))
  assert.doesNotMatch(firstBytes.toString("utf8"), /RAW-PRODUCER-SENTINEL/)

  const second = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH,
    maxFiles: 100,
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 1024 * 1024
  })

  assert.equal(second.cacheStatus, "hit")
  assert.equal(second.reusedFiles, 3)
  assert.equal(second.rebuiltFiles, 0)
  assert.deepEqual(fs.readFileSync(indexFile), firstBytes)
})

test("repository index cache rebuilds changed files, drops deleted files, and re-resolves cached references", async () => {
  const workspace = createProducerWorkspace()
  const { produceRepositorySymbolIndex } = producerApi()
  const firstRevision = head(workspace)

  await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: firstRevision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH
  })

  fs.writeFileSync(
    path.join(workspace, "src/helper.ts"),
    "export function helper(value: string) { return value.toUpperCase() }\nexport function extra() { return 'extra' }\n",
    "utf8"
  )
  git(workspace, "add", "src/helper.ts")
  git(workspace, "commit", "-m", "change helper")
  const secondRevision = head(workspace)

  const changed = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: secondRevision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH
  })
  assert.equal(changed.cacheStatus, "partial")
  assert.equal(changed.rebuiltFiles, 1)
  assert.equal(changed.reusedFiles, 2)
  assert.equal(changed.removedFiles, 0)
  const changedIndex = readJson(workspace, INDEX_PATH)
  assert.equal(changedIndex.index.source_revision, secondRevision)
  assert.ok(changedIndex.symbols.some((item) => item.id === "function:src/helper.ts#extra"))
  assert.ok(changedIndex.edges.some((item) => item.from === "file:src/api.ts" && item.to === "function:src/helper.ts#helper" && item.kind === "calls"))

  fs.rmSync(path.join(workspace, "test/api.test.ts"))
  git(workspace, "add", "-A")
  git(workspace, "commit", "-m", "remove test")
  const thirdRevision = head(workspace)
  const removed = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: thirdRevision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH
  })

  assert.equal(removed.removedFiles, 1)
  assert.equal(removed.rebuiltFiles, 0)
  assert.equal(removed.reusedFiles, 2)
  const removedIndex = readJson(workspace, INDEX_PATH)
  assert.equal(removedIndex.symbols.some((item) => item.path === "test/api.test.ts"), false)
  assert.equal(removedIndex.edges.some((item) => item.from === "file:test/api.test.ts"), false)
})

test("repository index cache invalidates all fragments when producer options change", async () => {
  const workspace = createProducerWorkspace()
  const revision = head(workspace)
  const { produceRepositorySymbolIndex } = producerApi()

  await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH,
    includeLanguages: ["typescript"],
    textEncoding: "utf8"
  })
  const rebuilt = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH,
    includeLanguages: ["typescript", "javascript"],
    textEncoding: "utf8"
  })

  assert.equal(rebuilt.cacheStatus, "miss")
  assert.equal(rebuilt.rebuiltFiles, 3)
  assert.equal(rebuilt.reusedFiles, 0)

  const encodingChanged = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH,
    includeLanguages: ["typescript", "javascript"],
    textEncoding: "auto"
  })
  assert.equal(encodingChanged.cacheStatus, "miss")
  assert.equal(encodingChanged.rebuiltFiles, 3)
})

test("repository index producer ignores corrupt cache and rebuilds from immutable git blobs", async () => {
  const workspace = createProducerWorkspace()
  const revision = head(workspace)
  const { produceRepositorySymbolIndex } = producerApi()

  fs.mkdirSync(path.dirname(path.join(workspace, CACHE_PATH)), { recursive: true })
  fs.writeFileSync(path.join(workspace, CACHE_PATH), "{not-json", "utf8")
  const result = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    sourceRevision: revision,
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH
  })

  assert.equal(result.cacheStatus, "miss")
  assert.equal(result.rebuiltFiles, 3)
  assert.ok(result.warnings.some((warning) => warning.includes("cache ignored")))
  assert.equal(readJson(workspace, INDEX_PATH).index.source_revision, revision)
})

test("repository index producer rejects stale or dirty revisions and unsafe output paths", async () => {
  const workspace = createProducerWorkspace()
  const revision = head(workspace)
  const { produceRepositorySymbolIndex } = producerApi()

  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: "f".repeat(40),
      indexPath: INDEX_PATH,
      cachePath: CACHE_PATH
    }),
    /source revision does not match checked out HEAD/
  )

  fs.appendFileSync(path.join(workspace, "src/api.ts"), "// dirty\n")
  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: INDEX_PATH,
      cachePath: CACHE_PATH
    }),
    /tracked workspace content differs from source revision/
  )
  git(workspace, "checkout", "--", "src/api.ts")

  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: "repository-symbol-index.json",
      cachePath: CACHE_PATH
    }),
    /repositorySymbolIndexPath must be under/
  )
  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: INDEX_PATH,
      cachePath: "../cache.json"
    }),
    /repositorySymbolIndexCachePath/
  )
})

test("repository index producer enforces file-count, per-file, and aggregate byte limits", async () => {
  const workspace = createProducerWorkspace()
  const revision = head(workspace)
  const { produceRepositorySymbolIndex } = producerApi()

  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: INDEX_PATH,
      cachePath: CACHE_PATH,
      maxFiles: 2
    }),
    /source file count exceeded maxFiles/
  )
  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: INDEX_PATH,
      cachePath: CACHE_PATH,
      maxFileBytes: 8
    }),
    /source file exceeded maxFileBytes/
  )
  await assert.rejects(
    produceRepositorySymbolIndex({
      workspaceRoot: workspace,
      sourceRevision: revision,
      indexPath: INDEX_PATH,
      cachePath: CACHE_PATH,
      maxTotalBytes: 16
    }),
    /source bytes exceeded maxTotalBytes/
  )
})

test("preprocess build mode produces and immediately consumes a cached repository index", async () => {
  const workspace = createMultiLanguageGitReviewWorkspace()
  const inputPath = path.join(workspace, "review-input.yaml")
  const original = fs.readFileSync(inputPath, "utf8")
  const newline = original.includes("\r\n") ? "\r\n" : "\n"
  const configured = original.replace(
    /analysis_options:\r?\n/,
    `analysis_options:${newline}  repository_symbol_index_mode: build${newline}  repository_symbol_index_path: ${INDEX_PATH}${newline}  repository_symbol_index_cache_path: ${CACHE_PATH}${newline}  language:${newline}    - typescript${newline}    - markdown${newline}`
  )
  assert.notEqual(configured, original)
  fs.writeFileSync(inputPath, configured, "utf8")

  const first = await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })
  assert.ok(first.repositoryIndexBuild)
  assert.equal(first.repositoryIndexBuild.cacheStatus, "miss")
  assert.ok(first.repositoryIndexBuild.rebuiltFiles > 0)
  assert.ok(first.repositoryIndexBuild.warnings.some((warning) => warning.includes("unsupported review languages omitted") && warning.includes("markdown")))
  const report = readJson(workspace, ".bob-review/review-package/context-budget-report.json")
  assert.equal(report.symbol_index.source_revision, head(workspace))
  assert.equal(fs.existsSync(path.join(workspace, INDEX_PATH)), true)
  assert.equal(fs.existsSync(path.join(workspace, CACHE_PATH)), true)

  const second = await preprocessReview({
    workspaceRoot: workspace,
    inputPath,
    outDir: ".bob-review/review-package"
  })
  assert.ok(second.repositoryIndexBuild.reusedFiles > 0)
  assert.equal(second.repositoryIndexBuild.rebuiltFiles, 0)
})

test("repository index producer supports a nested git root while keeping generated files workspace-local", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-index-nested-"))
  const repositoryRoot = path.join(workspace, "repo")
  fs.mkdirSync(repositoryRoot, { recursive: true })
  fs.writeFileSync(path.join(repositoryRoot, "api.ts"), "export function api() { return 1 }\n", "utf8")
  fs.writeFileSync(path.join(repositoryRoot, ".gitignore"), ".bob/\n", "utf8")
  git(repositoryRoot, "init")
  git(repositoryRoot, "config", "user.email", "test@example.com")
  git(repositoryRoot, "config", "user.name", "Test User")
  git(repositoryRoot, "add", ".")
  git(repositoryRoot, "commit", "-m", "initial")

  const { produceRepositorySymbolIndex } = producerApi()
  const result = await produceRepositorySymbolIndex({
    workspaceRoot: workspace,
    repositoryRoot,
    sourceRevision: head(repositoryRoot),
    indexPath: INDEX_PATH,
    cachePath: CACHE_PATH
  })

  assert.equal(result.scannedFiles, 1)
  assert.ok(readJson(workspace, INDEX_PATH).symbols.some((item) => item.path === "api.ts"))
})

test("repository index producer is part of the explicit evidence-scope public surface", () => {
  const api = publicApi()
  assert.equal(typeof api.produceRepositorySymbolIndex, "function")
})

function createProducerWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-index-producer-"))
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true })
  fs.mkdirSync(path.join(workspace, "test"), { recursive: true })
  fs.writeFileSync(
    path.join(workspace, "src/api.ts"),
    [
      "import { helper } from './helper'",
      "export type Request = { id: string }",
      "export function api(request: Request) {",
      "  return helper(request.id) // RAW-PRODUCER-SENTINEL",
      "}",
      ""
    ].join("\n"),
    "utf8"
  )
  fs.writeFileSync(path.join(workspace, "src/helper.ts"), "export function helper(value: string) { return value }\n", "utf8")
  fs.writeFileSync(
    path.join(workspace, "test/api.test.ts"),
    "import { api } from '../src/api'\ntest('api', () => api({ id: 'x' }))\n",
    "utf8"
  )
  fs.writeFileSync(path.join(workspace, ".gitignore"), ".bob/\n.bob-review/\n", "utf8")
  git(workspace, "init")
  git(workspace, "config", "user.email", "test@example.com")
  git(workspace, "config", "user.name", "Test User")
  git(workspace, "config", "core.autocrlf", "false")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "initial")
  return workspace
}

function git(workspace, ...args) {
  return execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function head(workspace) {
  return git(workspace, "rev-parse", "HEAD")
}

function readJson(workspace, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(workspace, relativePath), "utf8"))
}

function edgeIdentity(edge) {
  return `${edge.from}\u0000${edge.to ?? ""}\u0000${edge.kind}\u0000${edge.resolution}\u0000${edge.reason}\u0000${edge.target_hint ?? ""}`
}
