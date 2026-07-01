const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const scriptPath = path.join(repoRoot, "docs", "workflows", "bazaar-project-rule-review", "integration", "launch-bob-bazaar-review-sandbox.ps1")

test("Bazaar integration sandbox launcher creates separate Bob and Bazaar roots", () => {
  const script = fs.readFileSync(scriptPath, "utf8")

  assert.match(script, /bob-bazaar-review-integration-/)
  assert.match(script, /\$BobWorkspaceDir = Join-Path \$SandboxRoot "bob-managed"/)
  assert.match(script, /\$BazaarRepoDir = Join-Path \$SandboxRoot "bazaar-source"/)
  assert.match(script, /if \(\(Resolve-Path -LiteralPath \$BobWorkspaceDir\)\.Path -eq \(Resolve-Path -LiteralPath \$BazaarRepoDir\)\.Path\)/)
  assert.match(script, /"name" = "bob-managed"/)
  assert.match(script, /"name" = "bazaar-source"/)
  assert.match(script, /\.code-workspace/)
})

test("Bazaar integration sandbox launcher builds a real Bazaar history with no aliases", () => {
  const script = fs.readFileSync(scriptPath, "utf8")

  assert.match(script, /function Invoke-Bazaar/)
  assert.match(script, /\$Arguments = @\("--no-aliases"\) \+ \$Arguments/)
  assert.match(script, /Invoke-Bazaar @\("init"\) \$BazaarRepoDir/)
  assert.match(script, /Invoke-Bazaar @\("add", "\."\) \$BazaarRepoDir/)
  assert.match(script, /Invoke-Bazaar @\("commit", "-m", "baseline: deterministic control behavior"\) \$BazaarRepoDir/)
  assert.match(script, /Invoke-Bazaar @\("commit", "-m", "introduce review matrix regressions"\) \$BazaarRepoDir/)
  assert.match(script, /Invoke-Bazaar @\("revno"\) \$BazaarRepoDir/)
  assert.doesNotMatch(script, /Invoke-CheckedCommand \$BzrCommand @\("(?!--no-aliases)/)
})

test("Bazaar integration sandbox launcher installs only the required companion extensions", () => {
  const script = fs.readFileSync(scriptPath, "utf8")

  assert.match(script, /bob2[\\/]bob-code/)
  assert.match(script, /--extensionDevelopmentPath/)
  assert.match(script, /workflow-register-0\.1\.0\.vsix/)
  assert.match(script, /bob-bazaar-review-0\.3\.0\.vsix/)
  assert.doesNotMatch(script, /bob-code-consistency-review-0\.1\.0\.vsix/)
  assert.doesNotMatch(script, /Copy-Item[^\r\n]*bob2[\\/]bob-code/)
})

test("Bazaar integration sandbox launcher seeds Bob review assets and expected findings", () => {
  const script = fs.readFileSync(scriptPath, "utf8")

  assert.match(script, /extensions[\\/]bob-bazaar-review[\\/]templates[\\/]\.bob/)
  assert.match(script, /mcp\.json\.template/)
  assert.match(script, /EXPECTED_BAZAAR_REVIEW_FINDINGS\.md/)
  assert.match(script, /RT-001[\s\S]*RT-002[\s\S]*IF-001[\s\S]*IF-002[\s\S]*GV-001[\s\S]*ERR-001[\s\S]*BOUND-001[\s\S]*DOC-001[\s\S]*UT-001/)
  assert.match(script, /Shift-JIS/)
  assert.match(script, /README-bob-bazaar-review-sandbox\.md/)
})
