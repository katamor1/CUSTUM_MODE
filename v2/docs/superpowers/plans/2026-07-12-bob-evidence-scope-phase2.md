# Bob Evidence Scope Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Wire the Phase 1 `bob-evidence-scope` domain into `preprocessReview` and emit an auditable `review-package/context-budget-report.json` artifact linked from `manifest.yaml`.

**Architecture:** A focused pipeline adapter converts validated `ReviewInput`, immutable-SHA `DiffSummary`, document evidence, code analysis, and normalized limits into the existing Phase 1 domain calls. `buildReviewPackage` receives the resulting artifact as an optional typed input, treats it as a managed output, writes it through the existing JSON helper, and records the handoff path in the package manifest.

**Tech Stack:** TypeScript 5.x, CommonJS, Node.js built-in test runner, existing YAML/JSON helpers, no new npm dependency.

## Global Constraints

- The existing VCS diff, code analysis, and document extraction remain the source of truth.
- `preprocessReview` keeps its public input and result shapes compatible.
- `context-budget-report.json` contains identities, priorities, token estimates, reasons, fingerprints, rule metadata, and unresolved impact; it does not duplicate raw source, raw diff, or raw document bodies.
- Project rules come only from `review-input.bob_options.evidence_scope_rules` in Phase 2.
- Invalid rule entries produce deterministic warnings and do not abort preprocessing.
- The token budget is `max(1, floor(maxBobInputBytes / 4))`, matching Phase 1's `ceil(text.length / 4)` estimate while remaining bounded by the existing review-input limit.
- Dependency depth uses `analysis_options.max_call_depth`, defaulting to `1` when absent.
- VCS base/head are recorded as immutable 40-character commit SHA values.
- The artifact is a managed package output and stale copies are removed on every package rebuild.
- `manifest.yaml` records the workspace-relative `context_budget_report` path only when the artifact is supplied.
- No new npm dependency is introduced.

---

### Task 1: Lock the pipeline and freshness contracts with failing tests

**Files:**
- Create: `extensions/bob-code-consistency-review/test/evidenceScopePipeline.test.js`

**Interfaces:**
- Consumes: `preprocessReview(input)` and `buildReviewPackage(input)`.
- Requires: `context-budget-report.json` generation, manifest linkage, warning propagation, immutable revision recording, privacy, and stale-artifact cleanup.

- [x] **Step 1: Write the failing pipeline test**

The test creates a multi-language fixture workspace, appends one valid language-scoped rule and one invalid rule, calls `preprocessReview`, and asserts:

```js
assert.equal(report.schema_version, 1)
assert.equal(report.selection_policy, "bob-evidence-scope-v1")
assert.match(report.source_revision, /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/)
assert.equal(report.budget.budgetTokens, 524288)
assert.ok(report.applicable_rules.some((rule) => rule.id === "typescript-change"))
assert.ok(report.warnings.some((warning) => warning.includes("broken-rule")))
assert.match(manifest, /context_budget_report: \.bob-review\/review-package\/context-budget-report\.json/)
```

- [x] **Step 2: Write the failing freshness test**

The test pre-creates `context-budget-report.json`, calls `buildReviewPackage` without a current artifact, and asserts the stale file no longer exists.

- [x] **Step 3: Verify RED**

Run:

```bash
cd extensions/bob-code-consistency-review
npm test
```

Observed at test-only commit `ba84a6ffd093210bc5979adff93cd00518ad9cdb`: dependency, architecture, source, unused, audit, and compile succeeded; Unit tests failed because report generation and stale cleanup were absent.

### Task 2: Build the review-context artifact adapter

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/reviewContextBudget.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`
- Modify: `extensions/bob-code-consistency-review/resources/schemas/review-input.schema.json`
- Modify: `docs/workflows/code-consistency-review/schemas/review-input.schema.json`

**Interfaces:**
- Produces: `buildReviewContextBudget(input): { artifact: ContextBudgetArtifact; warnings: string[] }`.
- Consumes: `parseProjectRules`, `buildReviewEvidenceScope`, and `createContextBudgetArtifact`.

- [x] **Step 1: Parse and normalize pipeline configuration**

Read `bob_options.evidence_scope_rules`, `bob_options.evidence_scope_include_low_priority`, `analysis_options.max_call_depth`, ticket IDs, review focus, review ID, title, and purpose. Deduplicate and sort document keywords.

The two new `bob_options` properties are explicitly admitted by both runtime and documentation schema. Unknown `bob_options` remain rejected.

- [x] **Step 2: Build the Phase 1 scope**

```ts
const scope = buildReviewEvidenceScope(codeAnalysis, documents, {
  tokenBudget: Math.max(1, Math.floor(limits.maxBobInputBytes / 4)),
  maxDependencyDepth: reviewInput.analysis_options?.max_call_depth ?? 1,
  rules: parsedRules.rules,
  documentKeywords,
  includeLowPriority: reviewInput.bob_options?.evidence_scope_include_low_priority === true
})
```

- [x] **Step 3: Merge deterministic warnings and serialize**

Parser and scope warnings are sorted and deduplicated, retained in the artifact, and returned to the pipeline. Metadata is:

```ts
{
  tokenEstimation: "ceil(text.length / 4); budget=floor(maxBobInputBytes / 4)",
  ruleSource: rawRules === undefined
    ? "none"
    : "review-input.bob_options.evidence_scope_rules"
}
```

- [x] **Step 4: Export the adapter explicitly**

Named exports were added without introducing `export *`.

### Task 3: Emit and link the managed report

**Files:**
- Modify: `extensions/bob-code-consistency-review/src/core/pipeline.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts`

**Interfaces:**
- `preprocessReview` passes `contextBudgetArtifact` to `buildReviewPackage` and includes its warnings in the returned warning list.
- `buildReviewPackage` accepts `contextBudgetArtifact?: ContextBudgetArtifact`.

- [x] **Step 1: Build the artifact after code and document analysis**

`buildReviewContextBudget` runs before traceability/package generation.

- [x] **Step 2: Write the managed JSON artifact**

`context-budget-report.json` is in `MANAGED_PACKAGE_OUTPUTS` and is written with `writeJsonFile` when supplied.

- [x] **Step 3: Link the artifact from the manifest**

When supplied, `inputs` contains:

```yaml
context_budget_report: .bob-review/review-package/context-budget-report.json
```

The line is omitted for low-level calls without an artifact.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd extensions/bob-code-consistency-review
npm test
npm run dependency:policy
npm run architecture:policy
npm run source:policy
npm run unused:report
npm run audit:prod
npm run package
npm run package:policy
```

Observed at implementation/test anchor `f2625ed3f6717b13aa826c609ed5b8409c93f062`: all extension and scaffold commands in `code-consistency-review-scaffold` run `29198683817` exited successfully.

### Task 4: Commit implementation and verification evidence

**Files:**
- Create: `docs/implementation/bob-evidence-scope-phase2-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase2-verification-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase2-manifest.json`
- Modify: `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- Modify: this plan

**Interfaces:**
- Produces reviewable implementation, validation, and checksum records for the committed files.

- [x] **Step 1: Record behavior and boundaries**

The implementation record documents pipeline order, configuration source, budget derivation, managed-output semantics, manifest handoff, privacy properties, and Phase 3 boundary.

- [x] **Step 2: Record RED and GREEN evidence**

The verification record includes RED failures, root causes, immutable revision correction, test count, policy gates, audit, package/VSIX checks, and CI conclusions.

- [x] **Step 3: Generate the SHA-256 manifest**

The manifest is generated from the committed file bytes and records path, byte size, and SHA-256 digest for each Phase 2 source, test, plan, schema, and documentation artifact.

- [x] **Step 4: Commit**

Implementation and evidence are committed to `codex/execute-shared-plan-6a53743e`. PR #72 remains draft while final-head CI completes.

## Self-review

- **Spec coverage:** Pipeline wiring, schema admission, report emission, immutable revision, manifest handoff, warnings, managed-output freshness, privacy, validation, and committed evidence are covered.
- **Placeholder scan:** No implementation placeholder remains.
- **Type consistency:** `ContextBudgetArtifact`, `buildReviewContextBudget`, `contextBudgetArtifact`, and `context_budget_report` are consistent across adapter, pipeline, package builder, tests, and documentation.
