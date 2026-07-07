const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { test } = require("node:test")

const { extensionRoot } = require("./helpers/sourceReader")

function writeFile(root, filePath, content) {
  const fullPath = path.join(root, filePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content)
}

function runImportCyclePolicy(srcRoot) {
  return spawnSync(process.execPath, [path.join(extensionRoot, "scripts", "check-import-cycles.js"), srcRoot], {
    cwd: extensionRoot,
    encoding: "utf8"
  })
}

test("import cycle policy accepts acyclic relative TypeScript imports", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "import-cycle-ok-"))
  const srcRoot = path.join(tempRoot, "src")
  writeFile(srcRoot, "a.ts", 'import { b } from "./b"\nexport const a = b\n')
  writeFile(srcRoot, "b.ts", "export const b = 1\n")

  const result = runImportCyclePolicy(srcRoot)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Import cycle policy OK/)
})

test("import cycle policy rejects circular relative TypeScript imports", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "import-cycle-fail-"))
  const srcRoot = path.join(tempRoot, "src")
  writeFile(srcRoot, "a.ts", 'import "./b"\n')
  writeFile(srcRoot, "b.ts", 'import "./nested/c"\n')
  writeFile(srcRoot, "nested/c.ts", 'import "../a"\n')

  const result = runImportCyclePolicy(srcRoot)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Import cycle:/)
  assert.match(result.stderr, /a\.ts -> b\.ts -> nested\/c\.ts -> a\.ts/)
})
