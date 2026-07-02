const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet } = require("./helpers/sourceReader")

test("workflow provider result notifications do not block step completion", () => {
  const source = readSourceSet([
    "extension.ts",
    "extensionCommandOptions.ts",
    "traceabilityCommands.ts",
    "reviewExecutionCommands.ts"
  ])

  assert.doesNotMatch(source, /await vscode\.window\.show(?:Information|Warning|Error)Message/)
  assert.match(source, /function notifyInfo\(message: string\): void/)
  assert.match(source, /vscode\.window\.setStatusBarMessage\(message, 5000\)/)
  assert.doesNotMatch(source, /showInformationMessage\(message\)/)
  assert.match(source, /void vscode\.window\.showErrorMessage\(message\)/)
})
