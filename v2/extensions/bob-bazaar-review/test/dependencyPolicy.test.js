const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath, readJson } = require("./helpers/sourceReader")

test("bob-bazaar-review dependency policy requires a committed lockfile with production license metadata", () => {
  const packageJson = readJson("package.json")
  const lockPath = path.join(extensionRoot, "package-lock.json")
  assert.ok(fs.existsSync(lockPath), "package-lock.json must be committed for reproducible VSIX builds")
  assert.equal(packageJson.scripts["dependency:policy"], "node --test test/dependencyPolicy.test.js")
  assert.equal(packageJson.scripts["architecture:policy"], "node ../../scripts/check-import-cycles.js src")
  assert.equal(packageJson.scripts["audit:prod"], "npm audit --omit=dev --audit-level=high")
  assert.equal(packageJson.scripts["package:policy"], "node ../../scripts/check-vsix-policy.js --max-bytes 200000")

  const gitignore = fs.readFileSync(repoPath(".gitignore"), "utf8").split(/\r?\n/)
  assert.ok(!gitignore.includes("extensions/bob-bazaar-review/package-lock.json"), "package-lock.json must not be ignored")

  const vscodeignore = fs.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8").split(/\r?\n/)
  assert.ok(vscodeignore.includes("out/**/*.map"), "compiled source maps must be excluded from the VSIX")

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
  const rootPackage = lock.packages?.[""]
  assert.deepEqual(Object.keys(rootPackage?.dependencies ?? {}).sort(), Object.keys(packageJson.dependencies ?? {}).sort())

  const missingLicenses = Object.entries(lock.packages ?? {})
    .filter(([packagePath, info]) => packagePath && !info.dev)
    .filter(([, info]) => typeof info.license !== "string" || info.license.trim().length === 0)
    .map(([packagePath]) => packagePath)

  assert.deepEqual(missingLicenses, [], "production dependency packages must include license metadata in package-lock.json")
})

test("bob-bazaar-review CI uses npm ci, dependency policy, production audit, tests, and VSIX packaging", () => {
  const workflowPath = repoPath(".github", "workflows", "extensions-quality.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const jobStart = workflow.indexOf("bob-bazaar-review:")
  assert.notEqual(jobStart, -1, "bob-bazaar-review job must exist")
  const jobEnd = workflow.indexOf("bob-code-consistency-review:", jobStart)
  const job = workflow.slice(jobStart, jobEnd === -1 ? undefined : jobEnd)

  assert.match(job, /working-directory: extensions\/bob-bazaar-review/)
  assert.match(job, /cache-dependency-path: extensions\/bob-bazaar-review\/package-lock\.json/)
  assert.match(job, /run: npm ci/)
  assert.match(job, /run: npm run dependency:policy/)
  assert.match(job, /run: npm run architecture:policy/)
  assert.match(job, /run: npm run audit:prod/)
  assert.match(job, /run: npm test/)
  assert.match(job, /run: npm run package/)
  assert.match(job, /run: npm run package:policy/)
  assert.doesNotMatch(job, /run: npm install/)
})
