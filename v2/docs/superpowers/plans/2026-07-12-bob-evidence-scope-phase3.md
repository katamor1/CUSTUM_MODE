# Bob Evidence Scope Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Load a workspace-local project rule-pack file read-only, validate its schema/version, apply its rules in the evidence-scope pipeline, and record stable source and SHA-256 provenance for stale detection and future artifact-ledger handoff.

**Architecture:** A new `projectRulePackLoader` owns path confinement, bounded read-only loading, raw-byte hashing, YAML/JSON parsing, and schema validation. `buildReviewContextBudget` becomes asynchronous, merges validated project rules with optional inline review rules, and passes rule-pack provenance into `context-budget-report.json`; `buildReviewPackage` records the same provenance and includes the content hash in its deterministic input hash.

**Tech Stack:** TypeScript 5.x, CommonJS, Node.js built-ins (`fs`, `crypto`), existing `yaml` and AJV dependencies, Node.js built-in test runner, no new npm dependency.

## Global Constraints

- The configuration key is `bob_options.evidence_scope_rule_pack_path`.
- The configured path must be workspace-relative, use `.yaml`, `.yml`, or `.json`, and remain inside the workspace after realpath/symlink resolution.
- The rule pack is opened read-only and is never rewritten, copied into the review package, or used to store credentials.
- Rule-pack bytes are limited by the normalized `maxDocumentBytes` processing limit.
- The SHA-256 digest is calculated from the exact raw file bytes and recorded with a `sha256:` prefix.
- The rule-pack document must have `schema_version: 1`, a non-empty `rule_pack.id`, a non-empty `rule_pack.version`, and a schema-valid `rules` array.
- Invalid or unsupported rule-pack documents abort preprocessing with a path-specific validation error; invalid inline rules remain deterministic warnings as in Phase 2.
- Project rule-pack rules are authoritative. Inline rules with new IDs are appended; an inline duplicate ID is ignored with a warning and the project rule is retained.
- Identical logical inputs and identical rule-pack bytes produce identical rules, provenance, and manifest input hashes.
- Changing only rule-pack bytes changes both `rule_pack.content_hash` and the package `artifact_metadata.input_hash`.
- The report and manifest contain provenance only; they do not duplicate the raw rule-pack body.
- No new npm dependency is introduced.

---

### Task 1: Lock rule-pack loading and stale-input contracts with failing tests

**Files:**
- Create: `extensions/bob-code-consistency-review/test/projectRulePack.test.js`

**Interfaces:**
- Requires: `loadProjectRulePack(input)`.
- Requires: asynchronous `buildReviewContextBudget(input)` through `preprocessReview`.
- Requires: `context-budget-report.json.rule_pack` and manifest rule-pack provenance.

- [x] **Step 1: Write the failing bounded-loader test**

Create a temporary workspace and `.bob/evidence-scope/project-rules.yaml` with:

```yaml
schema_version: 1
rule_pack:
  id: payment-review
  version: "2026.07"
rules:
  - id: typescript-change
    title: TypeScript change review
    evaluation: ai
    estimated_tokens: 25
    applies_when:
      languages:
        - typescript
```

Assert that `loadProjectRulePack` returns the normalized workspace-relative source path, pack ID/version, parsed rule, and a `sha256:<64 hex>` raw-byte hash. Read the file before and after loading and assert the bytes are unchanged.

- [x] **Step 2: Write the failing validation-boundary tests**

Assert that:

```js
await assert.rejects(
  loadProjectRulePack({ workspaceRoot, rulePackPath: "../outside.yaml", maxBytes: 4096 }),
  /must be workspace-relative|escapes workspace/
)
```

and that a pack with `schema_version: 2` is rejected with `Invalid evidence scope rule pack` and a schema-version diagnostic.

- [x] **Step 3: Write the failing pipeline provenance test**

Use `createMultiLanguageGitReviewWorkspace()`, create the rule pack, add `evidence_scope_rule_pack_path` under `bob_options`, run `preprocessReview`, and assert:

```js
assert.equal(report.rule_source, ".bob/evidence-scope/project-rules.yaml")
assert.equal(report.rule_pack.id, "payment-review")
assert.equal(report.rule_pack.version, "2026.07")
assert.match(report.rule_pack.content_hash, /^sha256:[0-9a-f]{64}$/)
assert.ok(report.applicable_rules.some((rule) => rule.id === "typescript-change"))
assert.match(manifest, /project_rule_pack: \.bob\/evidence-scope\/project-rules\.yaml/)
assert.match(manifest, /project_rule_pack_hash: sha256:[0-9a-f]{64}/)
```

Change only the rule-pack file bytes, rerun preprocessing, and assert the report hash and manifest `input_hash` both change while the review input and Git revisions remain unchanged.

- [x] **Step 4: Verify RED**

Run:

```bash
cd extensions/bob-code-consistency-review
npm test
```

Expected: FAIL because `projectRulePackLoader` does not exist and the pipeline does not expose rule-pack provenance.

### Task 2: Implement read-only loading, schema validation, and rule merging

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/projectRulePackLoader.ts`
- Create: `extensions/bob-code-consistency-review/resources/schemas/evidence-scope-rule-pack.schema.json`
- Create: `docs/workflows/code-consistency-review/schemas/evidence-scope-rule-pack.schema.json`
- Modify: `extensions/bob-code-consistency-review/src/core/schemaLoader.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`

**Interfaces:**
- Produces: `loadProjectRulePack(input): Promise<LoadedProjectRulePack | undefined>`.
- Produces: `mergeProjectRules(projectRules, inlineRules): { rules, warnings }`.
- Produces: `ProjectRulePackProvenance` with `id`, `version`, `sourcePath`, and `contentHash`.

- [x] **Step 1: Add the v1 rule-pack schema**

The schema requires:

```json
{
  "schema_version": 1,
  "rule_pack": { "id": "non-empty", "version": "non-empty" },
  "rules": []
}
```

Each rule uses the existing rule contract: `id`, `title`, `evaluation`, optional `estimated_tokens`, optional priority, and structured `applies_when`. Both runtime and mirrored documentation schemas must be byte-identical.

- [x] **Step 2: Implement bounded read-only loading**

Normalize the configured path with `normalizeChangedFilePathStrict`, resolve it with `resolveWorkspacePathStrict`, require a supported extension, open the file using mode `r`, reject files larger than `maxBytes` before or after reading, hash the exact buffer with SHA-256, and decode using the configured text encoding.

- [x] **Step 3: Validate and convert the document**

Parse with `YAML.parse`, validate with `loadSchemaValidator("evidence-scope-rule-pack")`, convert `rules` through `parseProjectRules`, and reject any semantic warnings from the authoritative pack, including duplicate IDs.

- [x] **Step 4: Merge inline rules deterministically**

Keep all project rule IDs first. Append inline rules whose IDs are absent. For duplicate inline IDs, retain the project rule and emit:

```text
duplicate inline evidence scope rule <id>; project rule pack entry retained.
```

Sort final rules and warnings deterministically.

- [x] **Step 5: Export the public surface explicitly**

Add named exports only; do not introduce `export *`.

### Task 3: Wire provenance into the report, manifest, and stale hash

**Files:**
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/contextBudgetArtifact.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/reviewContextBudget.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/pipeline.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts`
- Modify: `extensions/bob-code-consistency-review/resources/schemas/review-input.schema.json`
- Modify: `docs/workflows/code-consistency-review/schemas/review-input.schema.json`

**Interfaces:**
- `buildReviewContextBudget(input)` becomes asynchronous and receives `workspaceRoot` plus `textEncoding`.
- `ContextBudgetArtifact` gains optional `rule_pack` provenance.
- `manifest.yaml` records `project_rule_pack`, `project_rule_pack_id`, `project_rule_pack_version`, and `project_rule_pack_hash` when present.

- [x] **Step 1: Admit the configuration path**

Add `bob_options.evidence_scope_rule_pack_path` as a non-empty `.yaml`, `.yml`, or `.json` workspace-relative string in both review-input schemas.

- [x] **Step 2: Load and merge rules before scope selection**

Await the project loader, parse inline rules, merge them, and use the merged list in `buildReviewEvidenceScope`. Set `rule_source` to the normalized rule-pack path when a pack is present, otherwise preserve the Phase 2 inline/none behavior.

- [x] **Step 3: Serialize provenance without raw content**

Add this optional report object:

```json
{
  "rule_pack": {
    "schema_version": 1,
    "id": "payment-review",
    "version": "2026.07",
    "source_path": ".bob/evidence-scope/project-rules.yaml",
    "content_hash": "sha256:..."
  }
}
```

- [x] **Step 4: Connect provenance to stale and ledger inputs**

Add rule-pack fields under manifest `inputs`. Include `contextBudgetArtifact.rule_pack.content_hash` in the value used to produce `artifact_metadata.input_hash`; when no pack is configured, preserve deterministic Phase 2 behavior with an empty rule-pack hash input.

- [x] **Step 5: Verify GREEN and regression gates**

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

Expected: all commands exit `0`.

### Task 4: Commit implementation, validation, and provenance evidence

**Files:**
- Create: `docs/implementation/bob-evidence-scope-phase3-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase3-verification-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase3-manifest.json`
- Modify: `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- Modify: `docs/superpowers/plans/2026-07-12-bob-evidence-scope-phase3.md`

**Interfaces:**
- Produces reviewable implementation, TDD, CI, security-boundary, and checksum records.

- [x] **Step 1: Record behavior and boundaries**

Document the configuration contract, read-only path boundary, size limit, schema/version policy, merge precedence, exact-byte SHA-256 semantics, manifest handoff, stale-input behavior, and absence of raw rule-pack content in generated artifacts.

- [x] **Step 2: Record RED and GREEN evidence**

Include test-only commit SHA, expected RED failures, final test counts, policy checks, audit, VSIX packaging, Linux/Windows CI conclusions, and any investigated transient failure.

- [x] **Step 3: Generate the SHA-256 manifest**

Record each Phase 3 source, schema, test, plan, and documentation path with byte size and SHA-256 digest. The runtime and mirrored rule-pack schemas must have identical hashes.

- [x] **Step 4: Commit and update PR #72**

Commit all Phase 3 artifacts to `codex/execute-shared-plan-6a53743e`, keep the PR in draft state, update its description with implementation and verification evidence, and retain the branch for the next phase.

## Self-review

- **Spec coverage:** The plan covers read-only loading, path confinement, byte limits, schema/version validation, rule application, deterministic merge behavior, source/hash provenance, stale-input hashing, manifest/ledger handoff, tests, documentation, and committed evidence.
- **Placeholder scan:** No implementation placeholder is present; every task names exact files, APIs, commands, and expected behavior.
- **Type consistency:** `LoadedProjectRulePack`, `ProjectRulePackProvenance`, `rule_pack`, `evidence_scope_rule_pack_path`, and manifest field names are used consistently across loader, adapter, artifact, package builder, tests, and documentation.
