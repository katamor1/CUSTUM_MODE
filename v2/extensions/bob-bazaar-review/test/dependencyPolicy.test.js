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

test("bob-bazaar-review dependency policy requires a committed lockfile and local release scripts", () => {
  const packageJson = readJson("package.json")
  const lockPath = path.join(extensionRoot, "package-lock.json")
  assert.ok(fs.existsSync(lockPath), "package-lock.json must be committed for reproducible VSIX builds")

  assert.equal(packageJson.scripts["dependency:policy"], "node --test test/dependencyPolicy.test.js")
  assertLocalScript(packageJson, "architecture:policy", "node scripts/check-import-cycles.js src")
  assertLocalScript(packageJson, "source:policy", "node scripts/check-export-star-policy.js src")
  assertLocalScript(packageJson, "unused:policy", "node scripts/run-unused-policy.js")
  assertLocalScript(packageJson, "unused:report", "node scripts/run-unused-checks.js")
  assertLocalScript(packageJson, "artifact:policy", "node scripts/check-artifact-size-policy.js --max-bytes 12000 templates")
  assert.equal(packageJson.scripts["audit:prod"], "npm audit --omit=dev --audit-level=high")
  assert.equal(packageJson.scripts["vscode:prepublish"], "npm run compile")
  assertLocalScript(packageJson, "package:policy", "node scripts/check-vsix-policy.js --max-bytes 350000")
  assertLocalScript(packageJson, "package:metrics", "node scripts/report-vsix-metrics.js .")

  for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
    assert.doesNotMatch(command, /\.\.\//, `${scriptName} must not reference parent folders`)
  }

  assert.equal(packageJson.devDependencies.knip, "^5.0.0")
  assert.equal(packageJson.devDependencies.depcheck, "^1.4.7")
  assert.equal(packageJson.devDependencies["ts-prune"], "^0.10.3")

  const vscodeignore = fs.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8").split(/\r?\n/)
  assert.ok(vscodeignore.includes("out/**/*.map"), "compiled source maps must be excluded from the VSIX")
  assert.ok(vscodeignore.includes("docs/**"), "development docs must be excluded from the VSIX")

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
  const rootPackage = lock.packages?.[""]
  assert.deepEqual(Object.keys(rootPackage?.dependencies ?? {}).sort(), Object.keys(packageJson.dependencies ?? {}).sort())
  if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
    assert.equal(packageJson.scripts.package, "vsce package", "runtime dependencies must be collected by vsce")
    for (const dependencyName of Object.keys(packageJson.dependencies)) {
      assert.ok(vscodeignore.includes(`!node_modules/${dependencyName}/**`), `${dependencyName} must be included in the VSIX`)
    }
    assert.ok(vscodeignore.includes("!node_modules/argparse/**"), "js-yaml runtime transitive dependency must be included in the VSIX")
  }
})

test("bob-bazaar-review README documents generated artifacts, package budget, dependencies, CLI, and trust boundary", () => {
  const packageJson = readJson("package.json")
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")
  const packageBudget = packageJson.scripts["package:policy"].match(/--max-bytes\s+(\d+)/)?.[1]

  for (const phrase of [
    "生成物",
    ".bob/mcp.json",
    ".bob/review",
    "review-result",
    "VSIX サイズ",
    packageBudget,
    "暗黙依存",
    "IBM.bob-code",
    "workflow-register",
    "必要 CLI",
    "Node.js",
    "npm ci",
    "bzr --no-aliases",
    "npm run dependency:policy",
    "npm run architecture:policy",
    "npm run unused:policy",
    "npm run unused:report",
    "npm run artifact:policy",
    "npm run audit:prod",
    "npm run package:policy",
    "npm run package:metrics",
    "Trusted Workspace"
  ]) {
    assert.ok(readme.includes(phrase), `README must document: ${phrase}`)
  }
})
