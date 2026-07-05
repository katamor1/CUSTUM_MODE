const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath, readJson } = require("./helpers/sourceReader")

test("extension dependency policy requires a committed lockfile with production license metadata", () => {
  const packageJson = readJson("package.json")
  const lockPath = path.join(extensionRoot, "package-lock.json")
  assert.ok(fs.existsSync(lockPath), "package-lock.json must be committed for reproducible VSIX builds")
  assert.equal(packageJson.scripts["dependency:policy"], "node --test test/dependencyPolicy.test.js")
  assert.equal(packageJson.scripts["architecture:policy"], "node ../../scripts/check-import-cycles.js src")
  assert.equal(packageJson.scripts["source:policy"], "node ../../scripts/check-export-star-policy.js src")
  assert.equal(packageJson.scripts["unused:report"], "node ../../scripts/run-unused-checks.js")
  assert.equal(packageJson.scripts["audit:prod"], "npm audit --omit=dev --audit-level=high")
  assert.equal(packageJson.scripts["package:policy"], "node ../../scripts/check-vsix-policy.js --max-bytes 11000000")
  assert.equal(packageJson.devDependencies.knip, "^5.0.0")
  assert.equal(packageJson.devDependencies.depcheck, "^1.4.7")
  assert.equal(packageJson.devDependencies["ts-prune"], "^0.10.3")
  assert.equal(packageJson.dependencies["read-excel-file"], "^9.2.0")
  assert.ok(!packageJson.dependencies.xlsx, "xlsx must not be a production dependency because npm audit has no fixed version")

  const vscodeignore = fs.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8").split(/\r?\n/)
  assert.ok(vscodeignore.includes("out/**/*.map"), "compiled source maps must be excluded from the VSIX")
  assert.ok(vscodeignore.includes("docs/**"), "development docs must be excluded from the VSIX")

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
  const rootPackage = lock.packages?.[""]
  assert.deepEqual(Object.keys(rootPackage?.dependencies ?? {}).sort(), Object.keys(packageJson.dependencies ?? {}).sort())

  const missingLicenses = Object.entries(lock.packages ?? {})
    .filter(([packagePath, info]) => packagePath && !info.dev)
    .filter(([, info]) => typeof info.license !== "string" || info.license.trim().length === 0)
    .map(([packagePath]) => packagePath)

  assert.deepEqual(missingLicenses, [], "production dependency packages must include license metadata in package-lock.json")
})

test("extension CI uses npm ci, dependency policy, production audit, tests, and VSIX packaging", () => {
  const workflowPath = repoPath(".github", "workflows", "code-consistency-review-scaffold.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const extensionJob = workflow.slice(workflow.indexOf("validate-extension:"))

  assert.match(extensionJob, /cache-dependency-path: extensions\/bob-code-consistency-review\/package-lock\.json/)
  assert.match(extensionJob, /run: npm ci/)
  assert.match(extensionJob, /run: npm run dependency:policy/)
  assert.match(extensionJob, /run: npm run architecture:policy/)
  assert.match(extensionJob, /run: npm run source:policy/)
  assert.match(extensionJob, /run: npm run unused:report/)
  assert.match(extensionJob, /run: npm run audit:prod/)
  assert.match(extensionJob, /run: npm test/)
  assert.match(extensionJob, /run: npm run package/)
  assert.match(extensionJob, /run: npm run package:policy/)
  assert.doesNotMatch(extensionJob, /run: npm install/)

  const sharedWorkflowPath = repoPath(".github", "workflows", "extensions-quality.yml")
  const sharedWorkflow = fs.readFileSync(sharedWorkflowPath, "utf8")
  const sharedJobStart = sharedWorkflow.indexOf("bob-code-consistency-review:")
  assert.notEqual(sharedJobStart, -1, "bob-code-consistency-review shared CI job must exist")
  const sharedJob = sharedWorkflow.slice(sharedJobStart)
  assert.match(sharedJob, /working-directory: extensions\/bob-code-consistency-review/)
  assert.match(sharedJob, /run: npm run architecture:policy/)
  assert.match(sharedJob, /run: npm run source:policy/)
  assert.match(sharedJob, /run: npm run unused:report/)
  assert.match(sharedJob, /run: npm run package:policy/)
})

test("extension README documents generated artifacts, package budget, dependencies, CLI, and trust boundary", () => {
  const packageJson = readJson("package.json")
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")
  const packageBudget = packageJson.scripts["package:policy"].match(/--max-bytes\s+(\d+)/)?.[1]

  for (const phrase of [
    "生成物",
    ".bob-review",
    ".bob-trace",
    "review-package",
    "VSIX サイズ",
    packageBudget,
    "暗黙依存",
    "IBM.bob-code",
    "workflow-register",
    "必要 CLI",
    "Node.js",
    "npm ci",
    "git",
    "bzr --no-aliases",
    "npm run dependency:policy",
    "npm run architecture:policy",
    "npm run unused:report",
    "npm run audit:prod",
    "npm run package:policy",
    "Trusted Workspace"
  ]) {
    assert.ok(readme.includes(phrase), `README must document: ${phrase}`)
  }
})
