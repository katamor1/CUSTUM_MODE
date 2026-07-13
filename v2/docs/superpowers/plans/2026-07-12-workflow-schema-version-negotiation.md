# Workflow Schema Version Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `workflow-register` route only omitted/explicit legacy and `workflow-register/v1` definitions, while rejecting every unsupported or malformed explicit `schemaVersion` consistently across parsing, validation, loading, and registration.

**Architecture:** Add one internal schema-version resolver under `src/core/parser/` and call it before legacy/v1 parser dispatch. Keep the existing legacy and v1 parsers unchanged; let the existing single compiler carry stable parser failures to every validation and registration entry point.

**Tech Stack:** TypeScript, Node.js built-in test runner, `js-yaml`, existing workflow compiler and VS Code test stubs.

## Global Constraints

- Preserve workflow definitions with omitted `schemaVersion` as legacy.
- Accept exact, case-sensitive `schemaVersion: legacy` and `schemaVersion: workflow-register/v1` only.
- Reject unsupported strings and every non-string explicit value before either parser is called.
- Do not trim, case-fold, downgrade, or otherwise normalize explicit version values.
- Preserve existing v1/legacy IDs, hashes, schema validation, provider IDs, command IDs, and runtime behavior.
- Registration, current-document validation, workspace validation, and direct compilation must share the same diagnostic.
- Unsupported documents must never create a runner, register a Bob source, or register a workflow.
- Production code changes require focused failing regression tests first.

---

### Task 1: Add RED Parser and Registration-Parity Regressions

**Files:**
- Modify: `extensions/workflow-register/test/workflowParserV1.test.js`
- Modify: `extensions/workflow-register/test/workflowCompilerParity.test.js`

**Interfaces:**
- Consumes: existing `parseWorkflowMarkdown()`, `compileWorkflowDocument()`, validation commands, loader, and registration service.
- Produces: executable acceptance tests for the version-routing contract and exact diagnostics.

- [ ] **Step 1: Add parser routing and rejection tests**

Append tests equivalent to the following to `workflowParserV1.test.js`:

```js
test("explicit legacy schemaVersion remains compatible", () => {
  const filePath = "C:/repo/.bob/workflows/legacy/WORKFLOW.md"
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath,
    text: `---
schemaVersion: legacy
name: legacy
 description: Legacy workflow.
---
# Legacy

Do the legacy workflow.
`.replace("\n description:", "\ndescription:")
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.schemaVersion, "legacy")
})

test("unsupported schemaVersion strings fail closed instead of using the legacy parser", async (t) => {
  const filePath = "C:/repo/.bob/workflows/unsupported/WORKFLOW.md"
  const cases = [
    ["future version", "schemaVersion: workflow-register/v2", "workflow-register/v2"],
    ["case typo", "schemaVersion: workflow-register/V1", "workflow-register/V1"],
    ["escaped control text", "schemaVersion: \"workflow-register/v2\\npreview\"", "workflow-register/v2\\npreview"]
  ]

  for (const [name, versionLine, renderedValue] of cases) {
    await t.test(name, () => {
      const parsed = parseWorkflowMarkdown({
        sourceId: "workflow-register",
        filePath,
        text: `---
${versionLine}
name: unsupported
description: Unsupported workflow.
---
# Unsupported
`
      })

      assert.equal(parsed.ok, false)
      assert.deepEqual(parsed.diagnostics, [
        `- fail: ${filePath}: unsupported schemaVersion \"${renderedValue}\"; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.`
      ])
    })
  }
})

test("non-string schemaVersion values fail closed", async (t) => {
  const filePath = "C:/repo/.bob/workflows/invalid-version/WORKFLOW.md"
  const values = [
    ["number", "schemaVersion: 2"],
    ["boolean", "schemaVersion: false"],
    ["null", "schemaVersion: null"],
    ["sequence", "schemaVersion:\n  - workflow-register/v1"],
    ["mapping", "schemaVersion:\n  family: workflow-register\n  version: v1"]
  ]

  for (const [name, versionYaml] of values) {
    await t.test(name, () => {
      const parsed = parseWorkflowMarkdown({
        sourceId: "workflow-register",
        filePath,
        text: `---
${versionYaml}
name: invalid-version
description: Invalid version workflow.
---
# Invalid
`
      })

      assert.equal(parsed.ok, false)
      assert.deepEqual(parsed.diagnostics, [
        `- fail: ${filePath}: field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'.`
      ])
    })
  }
})
```

When applying the change, write the explicit-legacy fixture directly without the `.replace()` convenience shown above; it is included only to keep this plan's Markdown indentation unambiguous.

- [ ] **Step 2: Add compiler/loading/registration parity coverage**

Define this fixture near the existing workflow constants in `workflowCompilerParity.test.js`:

```js
const unsupportedVersionWorkflow = `---
schemaVersion: workflow-register/v2
name: unsupported-version
description: Unsupported version workflow.
---
# Unsupported Version
`
```

Add a test that creates a real workspace file and asserts the shared compiler boundary:

```js
test("unsupported schema versions fail identically before loading or registration", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workflow-version-negotiation-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const workflowPath = await writeWorkflow(root, "unsupported-version", unsupportedVersionWorkflow)
  resetRuntime(root, [workflowPath])

  const filePath = ".bob/workflows/unsupported-version/WORKFLOW.md"
  const expectedMessage = "unsupported schemaVersion \"workflow-register/v2\"; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows."
  const { compileWorkflowDocument, formatWorkflowDiagnostics } = require(path.join(outRoot, "core", "workflowCompiler.js"))
  const expected = compileWorkflowDocument({
    sourceId: "workflow-register",
    filePath,
    text: unsupportedVersionWorkflow,
    strict: true
  })

  assert.equal(expected.ok, false)
  assert.equal(expected.workflow, undefined)
  assert.deepEqual(expected.diagnostics, [{ severity: "error", message: expectedMessage, filePath }])

  const diagnosticsByFile = new Map()
  const diagnostics = {
    clear: () => diagnosticsByFile.clear(),
    set: (uri, result) => diagnosticsByFile.set(uri.fsPath, result)
  }
  const { validateTextDocument, validateWorkspaceWorkflows } = requireWithVscode(path.join("commands", "validateWorkflow.js"))
  const documentResult = validateTextDocument({
    uri: { fsPath: workflowPath },
    getText: () => unsupportedVersionWorkflow
  }, { sourceId: "workflow-register", diagnostics })
  await validateWorkspaceWorkflows({
    sourceId: "workflow-register",
    diagnostics,
    showMarkdownReport: async () => undefined
  })

  const { loadWorkspaceWorkflows } = requireWithVscode("workflowDefinitionLoader.js")
  const loaded = await loadWorkspaceWorkflows("workflow-register")
  let runnerCreations = 0
  const { registerWorkflows } = requireWithVscode("workflowRegistrationService.js")
  const registered = await registerWorkflows({
    createRunner: () => {
      runnerCreations += 1
      return runnerStub()
    }
  })
  const expectedLines = formatWorkflowDiagnostics(expected)

  assert.deepEqual(documentResult, expected)
  assert.deepEqual(diagnosticsByFile.get(workflowPath), expected)
  assert.deepEqual(loaded.workflows, [])
  assert.deepEqual(loaded.coreWorkflows, [])
  assert.deepEqual(loaded.diagnostics.slice(-expectedLines.length), expectedLines)
  assert.deepEqual(registered.coreWorkflows, [])
  assert.deepEqual(registered.result.lines.slice(-expectedLines.length), expectedLines)
  assert.equal(runnerCreations, 0)
  assert.equal(runtime.registerSourceCalls, 0)
  assert.deepEqual(runtime.registeredWorkflows, [])
})
```

- [ ] **Step 3: Run focused tests to verify RED**

Run from `extensions/workflow-register`:

```bash
npm.cmd run compile && node --test test/workflowParserV1.test.js test/workflowCompilerParity.test.js
```

Expected: FAIL because unsupported explicit versions are still routed to `parseLegacyWorkflow()` and accepted.

- [ ] **Step 4: Commit the RED tests**

```bash
git add extensions/workflow-register/test/workflowParserV1.test.js \
  extensions/workflow-register/test/workflowCompilerParity.test.js
git commit -m "test: reject unsupported workflow schema versions"
```

### Task 2: Implement Explicit Version Resolution

**Files:**
- Create: `extensions/workflow-register/src/core/parser/workflowSchemaVersion.ts`
- Modify: `extensions/workflow-register/src/core/parser/parseWorkflowMarkdown.ts`

**Interfaces:**
- Produces: `WorkflowSchemaRoute = "legacy" | "workflow-register/v1"`.
- Produces: `resolveWorkflowSchemaVersion(value: unknown): WorkflowSchemaRoute`.
- Consumes: the parsed YAML record's `schemaVersion` value.

- [ ] **Step 1: Create the internal resolver**

Create `workflowSchemaVersion.ts`:

```ts
export type WorkflowSchemaRoute = "legacy" | "workflow-register/v1"

export function resolveWorkflowSchemaVersion(value: unknown): WorkflowSchemaRoute {
  if (value === undefined || value === "legacy") return "legacy"
  if (value === "workflow-register/v1") return value
  if (typeof value !== "string") {
    throw new Error("field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'.")
  }
  throw new Error(
    `unsupported schemaVersion ${JSON.stringify(value)}; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.`
  )
}
```

- [ ] **Step 2: Route only known versions**

Update `parseWorkflowMarkdown.ts`:

```ts
import { resolveWorkflowSchemaVersion } from "./workflowSchemaVersion"
```

Replace the catch-all dispatch with:

```ts
const schemaVersion = resolveWorkflowSchemaVersion(fields.schemaVersion)
if (schemaVersion === "workflow-register/v1") {
  return parseV1Workflow(request, fields, split.body, request.text)
}
return parseLegacyWorkflow(request, fields, split.body, request.text)
```

Do not change either parser.

- [ ] **Step 3: Run focused tests to verify GREEN**

```bash
npm.cmd run compile && node --test test/workflowParserV1.test.js test/workflowCompilerParity.test.js
```

Expected: all focused parser/compiler tests pass with zero failures.

- [ ] **Step 4: Run parser/compiler-adjacent regressions**

```bash
node --test test/workflowAuthoringLoader.test.js test/workflowAuthoring.test.js test/workflowContractFiles.test.js test/processWorkflowContracts.test.js
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 5: Commit the implementation**

```bash
git add extensions/workflow-register/src/core/parser/workflowSchemaVersion.ts \
  extensions/workflow-register/src/core/parser/parseWorkflowMarkdown.ts
git commit -m "fix: fail closed on unsupported workflow schema versions"
```

### Task 3: Synchronize Contracts and Documentation

**Files:**
- Modify: `extensions/workflow-register/docs/workflow-authoring-guide.md`
- Modify: `extensions/workflow-register/docs/basic-design-ja.md`
- Modify: `extensions/workflow-register/docs/detailed-design-ja.md`
- Modify: `extensions/workflow-register/docs/unit-test-spec-ja.md`

**Interfaces:**
- Consumes: the version-routing contract from Task 2.
- Produces: user-facing and maintainer-facing compatibility guidance.

- [ ] **Step 1: Add the authoring compatibility table**

After the authoring guide's required-fields paragraph, add:

```markdown
## Schema version negotiation

| `schemaVersion` | Behavior |
| --- | --- |
| omitted | Parsed as a legacy workflow. |
| `legacy` | Parsed as a legacy workflow. |
| `workflow-register/v1` | Parsed and validated as a v1 workflow. |
| any other value | Rejected before legacy or v1 parsing. |

Version values are exact and case-sensitive. Unknown future versions and typographical errors are not downgraded to legacy workflows.
```

- [ ] **Step 2: Update basic and detailed design**

In `basic-design-ja.md`, state that the supported definition contracts are omitted/explicit legacy and exact v1, and that unsupported explicit versions are rejected.

In `detailed-design-ja.md`, replace the current statement that every non-v1 value uses the legacy parser with the explicit resolver table and the rule that malformed/unknown values produce parser errors before dispatch.

- [ ] **Step 3: Update the unit-test specification**

Document parser cases for omitted, explicit legacy, exact v1, unknown string, case typo, escaped control text, and non-string YAML values. Document the loading/registration assertion that unsupported documents create no runner/source/workflow.

- [ ] **Step 4: Run documentation-sensitive tests**

```bash
npm.cmd run compile
node --test test/workflowParserV1.test.js test/workflowCompilerParity.test.js test/workflowAuthoring.test.js
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 5: Commit documentation**

```bash
git add extensions/workflow-register/docs/workflow-authoring-guide.md \
  extensions/workflow-register/docs/basic-design-ja.md \
  extensions/workflow-register/docs/detailed-design-ja.md \
  extensions/workflow-register/docs/unit-test-spec-ja.md
git commit -m "docs: define workflow schema version negotiation"
```

### Task 4: Full Verification and Evidence

**Files:**
- Create: `docs/release-evidence/workflow-schema-version-negotiation-2026-07-12.md`
- Modify: `docs/superpowers/plans/2026-07-12-workflow-schema-version-negotiation.md` checkboxes and completion note.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: durable RED/GREEN, policy, package, and CI evidence.

- [ ] **Step 1: Run the full extension suite**

```bash
npm.cmd test
npm.cmd run dependency:policy
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run schema:policy
npm.cmd run unused:report
npm.cmd run audit:prod
npm.cmd run package
npm.cmd run package:policy
```

Expected: each command exits zero; `npm.cmd test` reports zero failed tests; the VSIX remains within 1,200,000 bytes.

- [ ] **Step 2: Run repository diff validation**

```bash
git diff --check main...HEAD
```

Expected: exit zero with no output.

- [ ] **Step 3: Record evidence honestly**

The evidence document must contain:

- base and final head SHAs;
- the observed RED output from the test-only commit;
- focused and full test counts from fresh runs;
- policy/package results and VSIX size/hash;
- GitHub Actions run/job IDs and whether runner steps actually started;
- any blocker without relabeling a failed or unstarted command as passing.

- [ ] **Step 4: Perform a focused diff review**

Review the final diff for:

- accidental acceptance of unknown values;
- change to legacy/v1 parser behavior;
- diagnostic injection/newline issues;
- validation/registration divergence;
- missing documentation or test cases.

Fix every Critical or Important finding and rerun affected verification.

- [ ] **Step 5: Commit completion evidence**

```bash
git add docs/release-evidence/workflow-schema-version-negotiation-2026-07-12.md \
  docs/superpowers/plans/2026-07-12-workflow-schema-version-negotiation.md
git commit -m "docs: record workflow schema negotiation evidence"
```

- [ ] **Step 6: Open or update a draft pull request**

Use base `main`, keep the PR draft until fresh local tests and GitHub-hosted runner jobs have usable evidence, and summarize the intentional compatibility change for arbitrary explicit `schemaVersion` values.