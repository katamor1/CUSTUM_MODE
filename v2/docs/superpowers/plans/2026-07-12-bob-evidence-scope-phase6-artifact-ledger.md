# Bob Evidence Scope Phase 6 Artifact Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a bounded persistent artifact ledger that records producer/review artifacts, dependency lineage, and stale-state propagation, then complete and verify the full `bob-evidence-scope` plan.

**Architecture:** A pure reconciliation engine owns state transitions and deterministic graph normalization. A bounded loader/writer owns workspace confinement and atomic persistence. `preprocessReview` performs an upstream checkpoint before package creation and a final checkpoint after package creation, using shared package input/content hash helpers.

**Tech Stack:** TypeScript 5.x, CommonJS, Node.js built-ins (`fs`, `crypto`, `path`), existing Node.js test runner and package tooling, no new npm dependency.

## Global Constraints

- Ledger path: `.bob-review/artifact-ledger.json`.
- Ledger schema: version 1, closed artifact kinds and statuses.
- Maximum records: 512; maximum dependencies per record: 64.
- Exact hashes use `sha256:<64 lowercase hex>`.
- Ledger stores metadata only, never source or artifact bodies.
- Existing `buildReviewPackage` return type remains unchanged.
- Upstream checkpoint must persist stale state before package generation.
- Final checkpoint must mark the rebuilt current package fresh.
- Runtime and documentation contracts must remain aligned.
- No new npm dependency.

---

### Task 1: Lock the ledger state machine with RED tests

**Files:**
- Create: `extensions/bob-code-consistency-review/test/artifactLedger.test.js`

**Interfaces:**
- Consumes: `reconcileArtifactLedger(previous, input)`.
- Produces required behavior for `ArtifactLedger`, `ArtifactObservation`, statuses, and stale reasons.

- [x] Write a failing test where changing the repository-index hash marks an unobserved dependent package stale.
- [x] Write a failing test where observing the rebuilt package in the same reconciliation keeps it fresh.
- [x] Write failing tests for missing upstream, source revision change, deterministic ordering, duplicate/self dependency, and no-body metadata shape.
- [x] Run `npm run compile && node --test test/artifactLedger.test.js`; verify failure because the ledger module does not exist.
- [x] Commit the RED contract.

### Task 2: Implement the pure ledger model and bounded persistence

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/artifactLedger.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/fileSystem.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`

**Interfaces:**
- Produces: `reconcileArtifactLedger`, `loadArtifactLedger`, `writeArtifactLedger`, `updateArtifactLedger`.
- Produces: `ArtifactLedger`, `ArtifactLedgerRecord`, `ArtifactObservation`, `ArtifactLedgerUpdateResult`.

- [x] Add the `artifact-ledger` workspace path policy.
- [x] Implement strict normalization, bounds, deterministic fixed-point stale propagation, and synthetic missing records.
- [x] Implement bounded read with recoverable corrupt-ledger warnings.
- [x] Implement atomic canonical JSON write.
- [x] Add explicit public exports.
- [x] Run focused tests and verify GREEN.
- [x] Commit and push this independently reviewable engine.

### Task 3: Share package input/content hashing

**Files:**
- Modify: `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts`
- Test: `extensions/bob-code-consistency-review/test/artifactLedger.test.js`

**Interfaces:**
- Produces: `computeReviewPackageInputHash(reviewInput, diff, contextBudgetArtifact)`.
- Produces: `computeManagedReviewPackageContentHash(outDir)`.

- [x] Add failing tests proving manifest and ledger use the same input hash.
- [x] Add a failing test for canonical managed-package byte hashing.
- [x] Refactor `buildManifest` to call the shared input-hash helper without changing manifest output semantics.
- [x] Implement managed-output hashing without including user files or the ledger.
- [x] Run focused and existing package freshness/privacy tests.
- [x] Commit and push the hashing boundary.

### Task 4: Integrate two ledger checkpoints into preprocessing

**Files:**
- Modify: `extensions/bob-code-consistency-review/src/core/pipeline.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/preprocessTypes.ts`
- Test: `extensions/bob-code-consistency-review/test/artifactLedger.test.js`

**Interfaces:**
- Upstream observations are derived from `contextBudgetArtifact.rule_pack`, `contextBudgetArtifact.symbol_index`, and optional built-in producer result.
- Final observation is `review-package:<review-id>` and depends on current upstream IDs.
- `PreprocessResult.artifactLedger` reports path and fresh/stale/missing counts.

- [x] Add a failing integration test for ledger creation and lineage.
- [x] Add a failing checkpoint test showing an upstream-only update persists a stale prior package.
- [x] Write the upstream checkpoint before package generation.
- [x] Write the final checkpoint after package hashing.
- [x] Merge ledger warnings into deterministic pipeline warnings and summary.
- [x] Verify build, consume, and no-index modes.
- [x] Commit and push the pipeline integration.

### Task 5: Complete documentation and final evidence

**Files:**
- Modify: `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- Modify: `docs/artifact-metadata-contract-ja.md`
- Create: `docs/implementation/bob-evidence-scope-phase6-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase6-verification-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase6-manifest.json`
- Modify: `docs/superpowers/plans/2026-07-12-bob-evidence-scope-phase6-artifact-ledger.md`

**Interfaces:**
- Produces durable architecture, security, stale-state, TDD, CI, and checksum evidence.

- [x] Document schema, states, two-checkpoint flow, privacy, recovery, and non-goals.
- [x] Record RED/GREEN commits and focused/full test evidence.
- [x] Run `npm test`, all policy/audit/package gates, and `git diff --check`.
- [x] Generate a byte-size/SHA-256 manifest covering spec, plan, docs, source, and tests.
- [x] Mark all plan checkboxes complete.
- [x] Commit and push final evidence.
- [x] Verify final Linux/Windows GitHub Actions, remove temporary workflows/artifacts, and update PR #72.

## Self-review

- **Coverage:** producer artifact, rule-pack artifact, review-package artifact, lineage, stale propagation, checkpoint failure safety, privacy, persistence, public API, tests, docs, and final CI are covered.
- **Placeholders:** no TBD/TODO or unspecified implementation step remains.
- **Type consistency:** ledger record, observation, update result, package hash helpers, pipeline result, and serialized field names are consistent across tasks.
- **Scope:** append-only history, server synchronization, Bazaar producer generation, and raw artifact storage remain out of scope.
