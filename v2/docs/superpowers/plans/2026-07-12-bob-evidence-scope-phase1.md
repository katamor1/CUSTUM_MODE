# Bob Evidence Scope Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a deterministic `bob-evidence-scope` domain boundary that selects the code, project rules, and document evidence relevant to one review while producing an auditable token-budget decision.

**Architecture:** Phase 1 stays inside `bob-code-consistency-review` so it can reuse the existing TypeScript build and CI without adding a new VSIX or runtime dependency. The domain is isolated under `src/evidenceScope/`, consumes existing `CodeAnalysisResult` and `DocumentExtractionResult` through an adapter, and exposes a stable public index for later extraction into a separate extension.

**Tech Stack:** TypeScript 5.x, CommonJS, Node.js built-in test runner, no new runtime dependencies.

## Global Constraints

- VCS diff and the existing code/document analyzers remain the source of truth.
- Output ordering and fingerprints must be deterministic for identical logical input, regardless of array order.
- Changed symbols, applicable rules, and other `required` items are retained even when their estimated size exceeds the configured budget.
- Direct dependencies are `high`; dependencies at depth two or greater are `medium`; unrelated raw context is `low` and excluded by default.
- Unresolved function-pointer, reflection, dynamic-SQL, or missing-index edges are retained as `unknownImpact`; they are never silently discarded.
- Rule applicability uses machine-readable path, language, symbol-kind, risk-tag, and interface-change predicates.
- Document evidence remains behind an adapter contract; phase 1 does not read UNC paths, save credentials, or duplicate raw documents.
- Token counts are estimates, not billing tokens. Phase 1 normalizes explicit estimates and the review adapter uses `ceil(text.length / 4)`.
- No new npm dependency is introduced.

---

### Task 1: Define the domain contracts and budget policy

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/evidenceScopeTypes.ts`
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/contextBudgetPlanner.ts`
- Test: `extensions/bob-code-consistency-review/test/evidenceScope.test.js`

**Interfaces:**
- Produces: `ScopeSymbol`, `DependencyEdge`, `ProjectRule`, `DocumentEvidenceAdapter`, `EvidenceScopeRequest`, `EvidenceScopeResult`.
- Produces: `planContextBudget(items, policy): ContextBudgetReport`.

- [x] Write a failing test proving required entries are retained, high/medium entries are excluded when the remaining budget is insufficient, and low entries are excluded by policy.
- [x] Run `node --test test/evidenceScope.test.js` and confirm failure because the new module does not exist.
- [x] Implement normalized token counts, deterministic priority ordering, duplicate merging, exclusion reasons, and required-budget overflow reporting.
- [x] Run `tsc -p ./ && node --test test/evidenceScope.test.js` and confirm the budget tests pass.

### Task 2: Add structured rule selection and document evidence adapter

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/rulePackEngine.ts`
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/projectRuleConfig.ts`
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/documentEvidenceAdapter.ts`
- Test: `extensions/bob-code-consistency-review/test/evidenceScope.test.js`

**Interfaces:**
- Produces: `selectApplicableRules(rules, symbols): ProjectRule[]`.
- Produces: `parseProjectRules(value): { rules, warnings }` for `review-input.bob_options.evidence_scope_rules`.
- Produces: `InMemoryDocumentEvidenceAdapter.findCandidates(query)` as the reference adapter behavior.

- [x] Write failing tests for path/language/risk/symbol/interface predicates, invalid rule diagnostics, document ranking, and duplicate evidence IDs.
- [x] Verify the tests fail because the modules do not exist.
- [x] Implement glob matching for `/`-normalized paths, all-specified-dimensions rule matching, snake_case configuration parsing, and deterministic evidence ranking.
- [x] Verify all new tests pass without adding dependencies.

### Task 3: Implement deterministic change-scope expansion

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/changeScopeEngine.ts`
- Test: `extensions/bob-code-consistency-review/test/evidenceScope.test.js`

**Interfaces:**
- Produces: `buildEvidenceScope(request): EvidenceScopeResult`.
- Consumes: contracts and planners from Tasks 1 and 2.

- [x] Write a failing test with one changed symbol, one direct dependency, one two-hop dependency, and one unresolved dynamic edge.
- [x] Verify the test fails because the engine does not exist.
- [x] Implement bounded breadth-first expansion across resolved incoming and outgoing edges.
- [x] Assign `required`, `high`, and `medium` priorities by depth; collect unresolved edges into `unknownImpact`.
- [x] Combine code, applicable rules, and document candidates through the budget planner.
- [x] Create a stable FNV-1a scope fingerprint from sorted selected and unknown-impact identities.
- [x] Verify reversed input arrays produce the same fingerprint and budget report.

### Task 4: Adapt existing analyzer outputs and serialize the audit artifact

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/reviewEvidenceAdapter.ts`
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/contextBudgetArtifact.ts`
- Test: `extensions/bob-code-consistency-review/test/evidenceScope.test.js`

**Interfaces:**
- Produces: `buildReviewEvidenceScope(codeAnalysis, documents, options)`.
- Produces: `createContextBudgetArtifact(scope, metadata)` for future `context-budget-report.json` emission.

- [x] Write failing tests converting existing changed symbols, functions, call graph entries, code slices, and document evidence.
- [x] Map function names in the current call graph back to stable symbol IDs when possible; preserve unresolved targets otherwise.
- [x] Derive language, compatibility risk, interface-change status, document keywords, and stable content fingerprints.
- [x] Serialize a deterministic schema-versioned artifact containing source revision, policy version, selected/excluded entries, rules, documents, and unknown impact.
- [x] Verify the adapter and artifact tests pass.

### Task 5: Publish a stable domain surface and documentation

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`
- Create: `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- Create: `docs/implementation/bob-evidence-scope-phase1-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase1-verification-2026-07-12.md`
- Test: `extensions/bob-code-consistency-review/test/evidenceScope.test.js`

**Interfaces:**
- Produces explicit named exports only; no `export *` is introduced.

- [x] Write a failing test requiring `out/evidenceScope` and checking the public functions.
- [x] Add an explicit public index and verify the test passes.
- [x] Rename the domain type module to `evidenceScopeTypes.ts` after the extension-wide source-layout test rejects generic `types.ts` imports.
- [x] Document phase-1 behavior, security boundaries, configuration shape, test evidence, and the next integration step.
- [x] Remove temporary shared-conversation capture files and restore the original Extension Host contract test.
- [x] Commit code, tests, plan, implementation report, and verification evidence to the existing feature branch.

## Self-review

- **Spec coverage:** Change Scope Engine, Project Rule Pack Engine, Document Evidence adapter, deterministic budgeting, explicit inclusion/exclusion reasons, and unknown-impact retention are implemented. Pipeline emission of `context-budget-report.json` is intentionally the next phase because this phase establishes and tests the extraction boundary first.
- **Placeholder scan:** The plan contains no implementation placeholders or undefined interfaces.
- **Type consistency:** Public names in later tasks match the contracts defined in Tasks 1–4.
