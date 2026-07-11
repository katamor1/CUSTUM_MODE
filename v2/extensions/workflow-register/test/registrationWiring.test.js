const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet } = require("./helpers/sourceReader")

function registrationSource() {
  return readSourceSet([
    "extension.ts",
    "workflowRegisterService.ts",
    "workflowRegistrationService.ts",
    "bobApi.ts",
    "reports.ts"
  ])
}

test("Bob registration deactivates the previous source before replacing workflows", () => {
  const source = registrationSource()

  assert.match(source, /interface BobSourceLike \{[\s\S]*deactivate\?: \(\) => unknown[\s\S]*\}/)
  assert.match(source, /private registeredSource\?: BobSourceLike/)
  assert.match(source, /dispose\(\): void \{[\s\S]*void deactivateRegisteredSource\(source\)[\s\S]*\}/)
  assert.match(
    source,
    new RegExp([
      "if \\(loaded\\.workflows\\.length === 0\\) \\{",
      "[\\s\\S]*await deactivateRegisteredSource\\(input\\.previousSource, lines\\)",
      "[\\s\\S]*\"setContext\", \"bob-code\\.hasWorkflows\", false",
      "[\\s\\S]*\\}"
    ].join(""))
  )
  assert.match(
    source,
    /await deactivateRegisteredSource\(input\.previousSource, lines\)[\s\S]*const sourceResult = await runAttempt\("registerSource\(sourceId, sourceName\)"/
  )
  assert.match(source, /if \(update\.sourceChanged\) this\.registeredSource = update\.registeredSource/)
})

test("Bob registration treats a false registerWorkflow return as failed", () => {
  const source = registrationSource()

  assert.match(source, /return \{ label, ok: value !== false, message: describeReturn\(value\), value \}/)
  assert.match(source, /const attempt = await runAttempt\([\s\S]*`source\.registerWorkflow\(\$\{workflow\.id\}\)`/)
  assert.match(source, /if \(attempt\.ok\) \{[\s\S]*registeredIds\.add\(workflow\.id\)[\s\S]*registeredCount \+= 1[\s\S]*\}/)
})

test("workflow reload re-registers current workflows and clears Bob context when none remain", () => {
  const source = registrationSource()

  assert.doesNotMatch(source, /this\.registeredIds\.has\(workflow\.id\)/)
  assert.doesNotMatch(source, /already registered in this extension host session/)
  assert.match(source, /if \(loaded\.workflows\.length === 0\) \{[\s\S]*"setContext", "bob-code\.hasWorkflows", false[\s\S]*\}/)
  assert.match(source, /this\.registeredIds\.clear\(\)[\s\S]*for \(const id of update\.registeredIds \?\? \[\]\) this\.registeredIds\.add\(id\)/)
  assert.match(source, /"setContext", "bob-code\.hasWorkflows", registeredIds\.size > 0/)
})

test("workflow service removes manually disposed action providers from its lifecycle store", () => {
  const source = registrationSource()

  assert.match(source, /import \{ ActionProviderRegistrationStore \} from "\.\/core\/actionProviderRegistrationStore"/)
  assert.match(source, /private readonly actionProviderRegistrations = new ActionProviderRegistrationStore\(\)/)
  assert.match(source, /return this\.actionProviderRegistrations\.track\(this\.actionRegistry\.register\(provider\)\)/)
  assert.match(source, /this\.actionProviderRegistrations\.dispose\(\)/)
  assert.doesNotMatch(source, /actionProviderRegistrations: ActionProviderRegistration\[\]/)
  assert.doesNotMatch(source, /actionProviderRegistrations\.push\(/)
})

test("workflow service closes the manual step panel during deactivation", () => {
  const source = registrationSource()

  assert.match(source, /dispose\(\): void \{[\s\S]*this\.watcher\.dispose\(\)[\s\S]*this\.manualStepPanel\.dispose\(\)/)
})
