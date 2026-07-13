# Workflow Schema Version Negotiation Design

- Status: Approved for implementation
- Date: 2026-07-12
- Repository: `katamor1/bob_builtin_analyze`
- Scope: `extensions/workflow-register`

## 1. Problem

`parseWorkflowMarkdown()` currently selects the v1 parser only when `schemaVersion === "workflow-register/v1"`; every other value is sent to the legacy parser. As a result, a future version such as `workflow-register/v2`, a typo such as `workflow-register/V1`, or a non-string YAML value can be accepted and normalized as a legacy workflow.

This is unsafe version negotiation. A document that declares a contract the extension does not understand must not be reinterpreted under a different contract.

## 2. Goal

Add explicit, deterministic schema-version negotiation before parser dispatch so that:

1. omitted `schemaVersion` remains compatible with legacy workflows;
2. explicit `schemaVersion: legacy` is accepted as legacy;
3. `schemaVersion: workflow-register/v1` continues to use the v1 parser;
4. unsupported strings and non-string values fail closed;
5. registration, current-document validation, workspace validation, and direct compilation report the same diagnostic;
6. unsupported documents are never adapted or registered with IBM Bob.

## 3. Non-goals

- Define or implement `workflow-register/v2`.
- Add minor-version or capability negotiation.
- Migrate legacy workflows to v1 automatically.
- Change `CoreWorkflowDefinition`, v1 schema validation, workflow IDs, hashes, provider IDs, or runtime behavior for accepted documents.
- Change Builder round-trip behavior beyond surfacing the parser diagnostic already produced by the shared compiler.

## 4. Version Routing Contract

| YAML value | Route | Result |
| --- | --- | --- |
| field omitted | legacy parser | accepted under existing legacy rules |
| `legacy` | legacy parser | accepted under existing legacy rules |
| `workflow-register/v1` | v1 parser | accepted or rejected by existing v1 schema/parser rules |
| any other string | none | parser failure with unsupported-version diagnostic |
| `null`, number, boolean, sequence, or mapping | none | parser failure with non-string diagnostic |

Values are exact and case-sensitive. The resolver does not trim or normalize an explicit value.

## 5. Diagnostics

The resolver throws stable errors that `parseWorkflowMarkdown()` converts into the existing parser diagnostic form:

```text
- fail: <filePath>: unsupported schemaVersion "workflow-register/v2"; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.
```

For a non-string value:

```text
- fail: <filePath>: field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'.
```

Unsupported string values are rendered with `JSON.stringify()` so control characters are escaped and cannot split the diagnostic into extra lines. The compiler continues to normalize the parser diagnostic into one error whose `filePath` is represented exactly once in formatted output.

## 6. Architecture

Create an internal parser helper:

```ts
export type WorkflowSchemaRoute = "legacy" | "workflow-register/v1"

export function resolveWorkflowSchemaVersion(value: unknown): WorkflowSchemaRoute
```

`parseWorkflowMarkdown()` performs these steps:

1. split YAML front matter;
2. parse YAML into a record;
3. resolve `fields.schemaVersion` through `resolveWorkflowSchemaVersion()`;
4. dispatch only the returned known route;
5. convert resolver/parser exceptions through the existing stable failure wrapper.

The resolver owns only version selection. Legacy and v1 parsers retain all existing field parsing, schema validation, hashes, and normalized model construction.

## 7. Compatibility and Intentional Behavior Change

Accepted legacy documents with no `schemaVersion` remain unchanged. Explicit `legacy` remains accepted. Existing v1 documents remain unchanged.

A document that previously contained an arbitrary explicit `schemaVersion` and happened to pass legacy parsing will now be rejected. This is intentional: an explicit unknown version is not a legacy declaration and must not be silently downgraded.

No persisted run-state migration is needed because this change affects workflow definition loading only. Existing accepted definitions retain their existing `schemaVersion`, IDs, and definition hashes.

## 8. Data and Error Flow

```text
WORKFLOW.md
  -> YAML front matter
  -> Record<string, unknown>
  -> resolveWorkflowSchemaVersion(value)
       -> legacy -----------------> parseLegacyWorkflow()
       -> workflow-register/v1 ---> parseV1Workflow()
       -> unsupported ------------> stable parser failure
  -> compileWorkflowDocument()
  -> validation / registration / diagnostics
```

Because all entry points already use the single compiler, the parser failure must flow unchanged to:

- direct `compileWorkflowDocument()` and `validateWorkflowText()`;
- current-document validation;
- workspace validation;
- workspace workflow loading;
- workflow registration.

## 9. Test Strategy

### Parser regression tests

Cover:

- omitted version remains legacy;
- explicit `legacy` remains legacy;
- v1 remains v1;
- `workflow-register/v2` fails with an exact escaped diagnostic;
- typo/case variant fails;
- numeric, boolean, null, sequence, and mapping values fail with the non-string diagnostic.

### Compiler and registration parity

Use a real workspace fixture with an unsupported version and prove:

- direct compiler result is `ok: false` with no normalized workflow;
- current and workspace validation match the same compiler result;
- loader returns no workflow/core workflow;
- registration creates no runner, registers no source, and registers no workflow;
- formatted diagnostics include the file path exactly once.

### Regression gates

Run:

```text
npm.cmd run compile
node --test test/workflowParserV1.test.js test/workflowCompilerParity.test.js
npm.cmd test
npm.cmd run dependency:policy
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run schema:policy
npm.cmd run package
npm.cmd run package:policy
```

Also run repository `git diff --check` where a local checkout is available.

## 10. Documentation

Update:

- `extensions/workflow-register/docs/workflow-authoring-guide.md` with the accepted-version table and fail-closed rule;
- `extensions/workflow-register/docs/basic-design-ja.md` to state that explicit unknown versions are rejected;
- `extensions/workflow-register/docs/detailed-design-ja.md` to replace the current catch-all legacy routing description;
- `extensions/workflow-register/docs/unit-test-spec-ja.md` with parser and registration-parity cases.

## 11. Rollout and Follow-on

Ship this as a focused compatibility-hardening change before run-state versioning. The next independent phase remains `run.json` schema versioning, decoding, migration-chain support, historical fixtures, and unknown-newer read-only protection.