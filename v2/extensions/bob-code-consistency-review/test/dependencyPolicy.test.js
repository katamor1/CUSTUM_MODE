const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, readJson } = require("./helpers/sourceReader")

function assertLocalScript(packageJson, scriptName, expectedCommand) {
  const command = packageJson.scripts[scriptName]
  assert.equal(command, expectedCommand)
  assert.doesNotMatch(command, /\.\./, `${scriptName} must stay within the extension root`)
  const scriptPath = command.match(/node\s+(scripts\/[^\s]+)/)?.[1]
  if (scriptPath) assert.ok(fs.existsSync(path.join(extensionRoot, scriptPath)), `${scriptName} target must exist locally`)
}

test("extension dependency policy requires a committed lockfile and local release scripts", () => {
  const packageJson = readJson("package.json")
  const lockPath = path.join(extensionRoot, "package-lock.json")
  assert.ok(fs.existsSync(lockPath), "package-lock.json must be committed for reproducible VSIX builds")

  assert.equal(packageJson.scripts["dependency:policy"], "node --test test/dependencyPolicy.test.js")
  assertLocalScript(packageJson, "architecture:policy", "node scripts/check-import-cycles.js src")
  assertLocalScript(packageJson, "source:policy", "node scripts/check-export-star-policy.js src")
  assertLocalScript(packageJson, "unused:report", "node scripts/run-unused-checks.js")
  assert.equal(packageJson.scripts["audit:prod"], "npm audit --omit=dev --audit-level=high")
  assertLocalScript(packageJson, "package:policy", "node scripts/check-vsix-policy.js --max-bytes 11000000")

  for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
    assert.doesNotMatch(command, /\.\.\//, `${scriptName} must not reference parent folders`)
  }

  assert.equal(packageJson.devDependencies.knip, "^5.0.0")
  assert.equal(packageJson.devDependencies.depcheck, "^1.4.7")
  assert.equal(packageJson.devDependencies["ts-prune"], "^0.10.3")
  assert.equal(packageJson.dependencies["read-excel-file"], "^9.2.0")
  assert.ok(!packageJson.dependencies.xlsx, "xlsx must not be a production dependency because npm audit has no fixed version")

  const vscodeignore = fs.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8").split(/\r?\n/)
  assert.ok(vscodeignore.includes("out/**/*.map"), "compiled source maps must be excluded from the VSIX")
  assert.ok(vscodeignore.includes("docs/**"), "development docs must be excluded from the VSIX")
  assert.ok(vscodeignore.includes(".vscode-test.json"), "generated VS Code test config must be excluded from the VSIX")

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
  const rootPackage = lock.packages?.[""]
  assert.deepEqual(Object.keys(rootPackage?.dependencies ?? {}).sort(), Object.keys(packageJson.dependencies ?? {}).sort())
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
