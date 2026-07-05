const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath, readJson } = require("./helpers/sourceReader")

test("workflow-register dependency policy requires a committed lockfile with production license metadata", () => {
  const packageJson = readJson("package.json")
  const lockPath = path.join(extensionRoot, "package-lock.json")
  assert.ok(fs.existsSync(lockPath), "package-lock.json must be committed for reproducible VSIX builds")
  assert.equal(packageJson.scripts["dependency:policy"], "node --test test/dependencyPolicy.test.js")
  assert.equal(packageJson.scripts["architecture:policy"], "node ../../scripts/check-import-cycles.js src")
  assert.equal(packageJson.scripts["source:policy"], "node ../../scripts/check-export-star-policy.js src --allow src/core/model.ts")
  assert.equal(packageJson.scripts["schema:policy"], "npm run compile && node --test test/workflowAuthoring.test.js")
  assert.equal(packageJson.scripts["unused:report"], "node ../../scripts/run-unused-checks.js")
  assert.equal(packageJson.scripts["audit:prod"], "npm audit --omit=dev --audit-level=high")
  assert.equal(packageJson.scripts["package:policy"], "node ../../scripts/check-vsix-policy.js --max-bytes 1200000")
  assert.equal(packageJson.devDependencies.knip, "^5.0.0")
  assert.equal(packageJson.devDependencies.depcheck, "^1.4.7")
  assert.equal(packageJson.devDependencies["ts-prune"], "^0.10.3")

  const gitignore = fs.readFileSync(repoPath(".gitignore"), "utf8").split(/\r?\n/)
  assert.ok(!gitignore.includes("extensions/workflow-register/package-lock.json"), "package-lock.json must not be ignored")

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

test("workflow-register CI uses npm ci, dependency policy, production audit, tests, and VSIX packaging", () => {
  const workflowPath = repoPath(".github", "workflows", "extensions-quality.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const jobStart = workflow.indexOf("workflow-register:")
  assert.notEqual(jobStart, -1, "workflow-register job must exist")
  const jobEnd = workflow.indexOf("bob-bazaar-review:", jobStart)
  const job = workflow.slice(jobStart, jobEnd === -1 ? undefined : jobEnd)

  assert.match(job, /working-directory: extensions\/workflow-register/)
  assert.match(job, /cache-dependency-path: extensions\/workflow-register\/package-lock\.json/)
  assert.match(job, /run: npm ci/)
  assert.match(job, /run: npm run dependency:policy/)
  assert.match(job, /run: npm run architecture:policy/)
  assert.match(job, /run: npm run source:policy/)
  assert.match(job, /run: npm run schema:policy/)
  assert.match(job, /run: npm run unused:report/)
  assert.match(job, /run: npm run audit:prod/)
  assert.match(job, /run: npm test/)
  assert.match(job, /run: npm run package/)
  assert.match(job, /run: npm run package:policy/)
  assert.doesNotMatch(job, /run: npm install/)
})

test("shared extension CI watches all quality gate scripts", () => {
  const workflowPath = repoPath(".github", "workflows", "extensions-quality.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const pullRequestPaths = workflow.slice(workflow.indexOf("pull_request:"), workflow.indexOf("push:"))
  const pushPaths = workflow.slice(workflow.indexOf("push:"), workflow.indexOf("workflow_dispatch:"))

  assert.match(pullRequestPaths, /- "scripts\/\*\.js"/)
  assert.match(pushPaths, /- "scripts\/\*\.js"/)
})

test("shared extension CI reports source metrics back to pull requests", () => {
  const workflowPath = repoPath(".github", "workflows", "extensions-quality.yml")
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const metricsScript = repoPath("scripts", "report-extension-metrics.js")

  assert.ok(fs.existsSync(metricsScript), "extension metrics script must be committed")
  assert.match(workflow, /extension-metrics:/)
  assert.match(workflow, /node scripts\/report-extension-metrics\.js --output extension-metrics\.md/)
  assert.match(workflow, /GITHUB_STEP_SUMMARY/)
  assert.match(workflow, /github\.rest\.issues\.(createComment|updateComment)/)
})

test("workflow-register README documents generated artifacts, package budget, dependencies, CLI, and trust boundary", () => {
  const packageJson = readJson("package.json")
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")
  const packageBudget = packageJson.scripts["package:policy"].match(/--max-bytes\s+(\d+)/)?.[1]

  for (const phrase of [
    "生成物",
    ".bob/workflows",
    ".bob/workflows/runs",
    "VSIX サイズ",
    packageBudget,
    "暗黙依存",
    "IBM.bob-code",
    "必要 CLI",
    "Node.js",
    "npm ci",
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

test("workflow-register source does not use global Object title augmentation", () => {
  const typeFixPath = path.join(extensionRoot, "src", "type-fixes.d.ts")
  assert.ok(!fs.existsSync(typeFixPath), "type-fixes.d.ts must not hide imprecise Object.title typing")

  const srcRoot = path.join(extensionRoot, "src")
  const stack = [srcRoot]
  const offenders = []
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }
      if (!entry.name.endsWith(".d.ts")) {
        continue
      }
      const text = fs.readFileSync(entryPath, "utf8")
      if (/\binterface\s+Object\b/.test(text)) {
        offenders.push(path.relative(extensionRoot, entryPath))
      }
    }
  }

  assert.deepEqual(offenders, [], "global Object augmentation must be replaced with precise local types")
})
