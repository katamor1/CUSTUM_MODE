# Workflow Validation Rules

Workflow validation has two layers.

## Schema validation

Schema validation checks whether the YAML front matter is structurally valid.

Examples:

- Required fields exist.
- Step types are one of `command`, `agent`, `manual`, or `result`.
- Command steps include `action.provider`.
- Result steps include `result`.
- Unknown nested fields are rejected where the schema is strict.

The runtime schema source is `src/core/workflowSchema.ts`. The public schema mirror is `schema/workflow-register.v1.schema.json`.

## Semantic validation

Semantic validation checks references that are valid YAML but likely invalid workflow design.

Current semantic checks include:

- Duplicate step ids.
- `todoRequired=true` without Todo items.
- `todoAsSteps=true` with unmatched Todo and step ids.
- `includeState` referencing an unknown `resultKey`.
- `result.source: state` referencing an unknown state key.
- Empty command or file result sinks.
- Duplicate artifact ids.
- `artifact.producedBy` referencing an unknown step id.
- `select` inputs without options.
- `requiredWhen` referencing an unknown input.
- Conflicting guardrails where a command is both allowed and denied.
- Optional provider/check allowlist validation when callers pass known providers or checks.

## Severity

- `error`: The workflow should not run until fixed.
- `warning`: The workflow may run, but the design is suspicious or incomplete.
- `info`: Parse or validation summary.

When `strict=true`, warnings are promoted to errors.

## Reports and Problems panel

Manual validation commands create a Markdown report. Errors and warnings are also written to a VS Code `DiagnosticCollection`, so they appear in the Problems panel.

For now, diagnostics are attached to the start of the file. Line-level YAML path mapping is intentionally deferred to avoid building a YAML language server inside the extension.

## Fix hints

The Markdown report includes hints for common errors, such as unknown `includeState`, duplicate step ids, missing select options, invalid YAML, and artifact `producedBy` references.
