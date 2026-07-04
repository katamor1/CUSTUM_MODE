# C Specification and Word Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse changed C projects with Tree-sitter WASM and append detailed new-function and new-variable/type specifications to the Word report.

**Architecture:** Build serializable C project models from Tree-sitter syntax trees, separately parse associated comments, diff symbols, resolve direct callers and type layouts, then render three Word chapters. The worker owns parser initialization and passes only final models to the document exporter.

**Tech Stack:** TypeScript, `web-tree-sitter`, Tree-sitter C WASM, docx, Vitest

---

### Task 1: Tree-sitter WASM Packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron.vite.config.ts`
- Create: `src/core/treeSitterRuntime.ts`
- Test: `tests/core/treeSitterRuntime.test.ts`

- [ ] **Step 1: Add a failing test that initializes the parser and parses `int f(void) { return 0; }`**
- [ ] **Step 2: Verify failure because dependencies/assets are absent**
- [ ] **Step 3: Install pinned `web-tree-sitter` and C grammar WASM dependency, copy WASM assets during build, and implement runtime path resolution**
- [ ] **Step 4: Verify parser test and production build**
- [ ] **Step 5: Commit `build: package tree sitter C wasm`**

### Task 2: C Project Parser

**Files:**
- Create: `src/core/cProjectModels.ts`
- Create: `src/core/cProjectParser.ts`
- Test: `tests/core/cProjectParser.test.ts`

- [ ] **Step 1: Write failing tests for functions, declarations, arrays, typedefs, enums, structs, unions, members, calls, macros, and pack directives**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Traverse named syntax nodes into serializable models with source ranges, raw declarations, normalized types, and paths**
- [ ] **Step 4: Preserve parse-error diagnostics without rejecting the whole file**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: parse C projects with tree sitter`**

### Task 3: Comment and Doxygen Parser

**Files:**
- Create: `src/core/doxygenParser.ts`
- Test: `tests/core/doxygenParser.test.ts`

- [ ] **Step 1: Write failing tests for adjacent comment groups, blank lines, separators, interruption by code, trailing comments, and all required tags**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement comment group association and parsed `brief/details/params/return/retval/note/warning` model**
- [ ] **Step 4: Return `記載なし` only at presentation-model construction, preserving missing values internally**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: parse Doxygen specification comments`**

### Task 4: New Symbol Diff

**Files:**
- Create: `src/core/cSpecificationDiff.ts`
- Test: `tests/core/cSpecificationDiff.test.ts`

- [ ] **Step 1: Write failing tests for new files, added functions/variables/types, existing record new members, excluded modifications, moves, and anonymous records**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement identifiers exactly as specified and build new-function/global-variable/record candidates**
- [ ] **Step 4: Verify focused tests pass**
- [ ] **Step 5: Commit `feat: identify new C specifications`**

### Task 5: Direct Caller Index

**Files:**
- Create: `src/core/cProjectIndex.ts`
- Test: `tests/core/cProjectIndex.test.ts`

- [ ] **Step 1: Write failing tests for direct calls, duplicate calls, calls outside functions, function pointers, macros, static duplicate names, and ambiguous global names**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Build call index keyed by resolvable function identity and emit `$/path.c : caller`**
- [ ] **Step 4: Mark unresolved duplicate-name targets as ambiguous instead of assigning callers**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: index direct C function callers`**

### Task 6: MSVC 32-bit Type Layout

**Files:**
- Create: `src/core/cConstantExpression.ts`
- Create: `src/core/cTypeLayout.ts`
- Test: `tests/core/cConstantExpression.test.ts`
- Test: `tests/core/cTypeLayout.test.ts`

- [ ] **Step 1: Write failing tests for safe integer expressions, macro recursion/cycles, built-ins, pointers, typedefs, arrays, struct padding, union size, pack push/pop, self pointers, unresolved types, VLA, flexible arrays, and bitfields**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement tokenizer/parser for allowed operators without `eval`**
- [ ] **Step 4: Implement recursive type resolver with cycle detection and MSVC 32-bit alignment rules**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: calculate MSVC 32-bit C layouts`**

### Task 7: Specification Model Assembly

**Files:**
- Create: `src/core/cSpecificationBuilder.ts`
- Modify: `src/core/cFunctionChanges.ts`
- Test: `tests/core/cSpecificationBuilder.test.ts`
- Modify: `tests/core/cFunctionChanges.test.ts`

- [ ] **Step 1: Write failing tests assembling parsed declarations, comments, callers, and sizes into final specification models**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Build function, variable, and record specifications with `記載なし`, `算出不可`, sorted callers, dimensions, and declarations**
- [ ] **Step 4: Replace the old lightweight function-change parser with Tree-sitter model comparison**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: build C specification models`**

### Task 8: Three-Chapter Word Document

**Files:**
- Modify: `src/core/changeListDocument.ts`
- Modify: `tests/core/changeListDocument.test.ts`

- [ ] **Step 1: Write a failing DOCX XML test for chapter order, no-items text, function tables, parameter/retval/caller tables, variable tables, record/member tables, and existing chapter preservation**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Add heading styles, reusable two-column/detail table helpers, header shading, wrapped cells, and three chapters**
- [ ] **Step 4: Verify focused Word tests pass**
- [ ] **Step 5: Commit `feat: add C specifications to Word report`**

### Task 9: Report Job Integration

**Files:**
- Modify: `src/core/reportJob.ts`
- Modify: `src/shared/jobMessages.ts`
- Modify: `tests/core/reportJob.test.ts`

- [ ] **Step 1: Write a failing integration test with added C functions, callers, variables, and record members**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Parse changed-before and all-after C files, build specifications, emit analysis/type/document progress, and pass models to Word exporter**
- [ ] **Step 4: Check abort signal between files and expensive phases**
- [ ] **Step 5: Verify integration tests pass**
- [ ] **Step 6: Commit `feat: integrate C specification generation`**

### Task 10: Samples, Documentation, and Verification

**Files:**
- Modify: `docs/01_basic_design.md`
- Modify: `docs/02_detailed_design.md`
- Modify: `docs/03_test_design.md`
- Modify: `docs/04_build_release_procedure.md`
- Create under ignored path: `local-samples/c-specification-diff/**`

- [ ] **Step 1: Add the ignored before/after sample covering all specified C constructs**
- [ ] **Step 2: Update all four documents to match settings, row omission, worker/cancel, Tree-sitter, and Word chapters**
- [ ] **Step 3: Run `npm test`**
- [ ] **Step 4: Run `npm run build` and `npm run dist:dir`**
- [ ] **Step 5: Run the sample end-to-end, inspect workbook and DOCX, and exercise cancellation**
- [ ] **Step 6: Run `git diff --check` and obsolete-code `rg` scans**
- [ ] **Step 7: Commit `docs: update report architecture and verification`**
