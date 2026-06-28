const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const scriptPath = path.join(repoRoot, "docs", "workflows", "code-consistency-review", "integration", "launch-bob-code-consistency-sandbox.ps1")

test("integration sandbox launcher uses Bob as an extension development path", () => {
  const script = fs.readFileSync(scriptPath, "utf8")

  assert.match(script, /Join-Path \$PSScriptRoot "\.\.\\\.\.\\\.\.\\\.\."/)
  assert.match(script, /bob2[\\/]bob-code/)
  assert.match(script, /--extensionDevelopmentPath/)
  assert.match(script, /workflow-register-0\.1\.0\.vsix/)
  assert.match(script, /bob-bazaar-review-0\.3\.0\.vsix/)
  assert.match(script, /bob-code-consistency-review-0\.1\.0\.vsix/)
  assert.match(script, /bob-workflow-integration-/)
  assert.doesNotMatch(script, /Copy-Item[\s\S]*bob2[\\/]bob-code[\s\S]*extensions/)
  assert.doesNotMatch(script, /WindowStyle\s+Hidden/)
})
