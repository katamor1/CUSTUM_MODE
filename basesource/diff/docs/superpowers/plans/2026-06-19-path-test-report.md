# Path Test Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a separate Excel path-test workbook containing only changed existing C functions and new C functions that have at least one test review marker.

**Architecture:** Parse each WinMerge HTML report once and share the resulting styled row model between the normal diff workbook and the path-test workbook. Use Tree-sitter to classify C functions, remove comment-only changes, find new-function branch entry lines, then map source line numbers back to WinMerge rows. Extend the existing worker, IPC, GUI, and output transaction to handle the third file atomically.

**Tech Stack:** Electron, React, TypeScript, Vitest, web-tree-sitter C grammar, ExcelJS streaming writer, WinMerge HTML reports.

---

## File Structure

- Create `src/core/cPathAnalysis.ts`: parse before/after C sources and produce function ranges, comment-free code lines, and new-function branch marker lines.
- Create `src/core/pathTestRows.ts`: map C function plans to WinMerge rows, assign E-column review markers, and remove markerless functions/sheets.
- Modify `src/core/excelExporter.ts`: parse HTML once and write the normal and path-test workbooks with shared cell styling.
- Modify `src/core/workbookTypes.ts`: carry source paths and the optional path-test output path.
- Modify `src/core/reportJob.ts`: pass C sources to the exporter and orchestrate the third output.
- Modify `src/core/outputTransaction.ts`: atomically stage, promote, roll back, and recover three outputs.
- Modify `src/shared/ipcTypes.ts`, `src/shared/jobMessages.ts`: add and validate the path-test output path and summary field.
- Modify `src/main/jobManager.ts`, `src/main/index.ts`, `src/preload/index.ts`: inspect/recover the third output and expose its save dialog.
- Modify `src/renderer/src/App.tsx`, `src/renderer/src/uiText.ts`: add the Japanese path-test workbook field and completion log.
- Create `tests/core/cPathAnalysis.test.ts`, `tests/core/pathTestRows.test.ts`: parser and row-selection behavior.
- Modify exporter, job, transaction, protocol, manager, and UI tests for the third output.
- Create `local-samples/path-test-c-diff/` under the existing Git-ignored sample tree.

### Task 1: C Function and Path Analysis

**Files:**
- Create: `tests/core/cPathAnalysis.test.ts`
- Create: `src/core/cPathAnalysis.ts`

- [ ] **Step 1: Write failing tests for function classification**

Add tests that call:

```ts
const result = await analyzeCPathChanges({
  status: "modified",
  beforeSource,
  afterSource
});
expect(result.functions.map(({ name, status }) => ({ name, status }))).toEqual([
  { name: "changed_existing", status: "modified" },
  { name: "new_function", status: "added" }
]);
```

The fixture must also contain deleted, comment-only, whitespace-only, global-only, `#define`-only, and `#pragma`-only changes and assert they are absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/core/cPathAnalysis.test.ts
```

Expected: FAIL because `src/core/cPathAnalysis.ts` and `analyzeCPathChanges` do not exist.

- [ ] **Step 3: Implement function classification**

Implement:

```ts
export interface CPathFunctionPlan {
  name: string;
  status: "modified" | "added";
  beforeRange?: SourceLineRange;
  afterRange: SourceLineRange;
  afterBodyStartLine: number;
  afterCodeByLine: ReadonlyMap<number, string>;
  newFunctionMarkerLines: ReadonlySet<number>;
}

export async function analyzeCPathChanges(
  input: AnalyzeCPathChangesInput
): Promise<CPathFilePlan>;
```

Parse each source with a fresh Tree-sitter parser. Compare functions by name after removing Tree-sitter comment ranges and collapsing whitespace. Omit deleted, comment-only, and whitespace-only functions.

- [ ] **Step 4: Add failing tests for new-function branch markers**

Use one new function containing `if`, `else if`, `else`, nested `if`, `switch`, `case`, `default`, `for`, `while`, `do-while`, and a conditional expression. Assert the marker line set contains the function body opening line and each branch/loop entry line, with duplicate line numbers collapsed.

- [ ] **Step 5: Run the focused test and verify RED**

Run the same focused Vitest command. Expected: classification tests pass and branch-marker assertions fail.

- [ ] **Step 6: Implement branch marker extraction**

Walk named nodes under the function body. Record starts for:

```ts
const MARKER_NODE_TYPES = new Set([
  "if_statement",
  "switch_statement",
  "case_statement",
  "for_statement",
  "while_statement",
  "do_statement",
  "conditional_expression"
]);
```

For each `if_statement`, also record the `alternative` field line so `else if` and `else` paths receive one marker. Exclude every line covered by a Tree-sitter `comment` node.

- [ ] **Step 7: Run tests and commit**

Run the focused tests and the existing parser/function-change tests. Commit:

```powershell
git add src/core/cPathAnalysis.ts tests/core/cPathAnalysis.test.ts
git commit -m "feat: analyze C path test targets"
```

### Task 2: Select Styled WinMerge Rows and Mark E Column

**Files:**
- Create: `tests/core/pathTestRows.test.ts`
- Create: `src/core/pathTestRows.ts`
- Modify: `src/core/htmlReport.ts`

- [ ] **Step 1: Write failing tests for row extraction**

Construct `HtmlReportRow[]` with a file header, two functions, line-number columns, normal rows, colored diff rows, and comment rows. Assert:

```ts
expect(selectPathTestRows(rows, plan)).toEqual({
  rows: [
    expect.objectContaining({ sourceRowNumber: 1, reviewMarker: false }),
    // only the function containing a marker
  ]
});
```

Verify `E1` is not marked, comment-only changed rows are not marked, a markerless function is removed, and a markerless sheet returns `undefined`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/core/pathTestRows.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement modified-function row markers**

Expand HTML colspans, parse A/C line numbers, and locate rows inside either the before or after function range. For existing functions:

- compare comment-stripped before/after code lines;
- mark changed or added executable after-side rows;
- ignore function declarations, brace-only rows, whitespace, and comments;
- map a deleted-only change to the next actionable after-side row, falling back to the function body opening row.

Return the header plus complete function ranges only when at least one row in that function is marked.

- [ ] **Step 4: Write and run failing tests for added functions**

Assert an added function uses `newFunctionMarkerLines` rather than marking every yellow added row, and that comments remain in A-D while E stays blank.

- [ ] **Step 5: Implement added-function mapping**

Map the plan’s after-source marker line numbers to C/D report rows. Deduplicate markers and preserve all function rows between declaration and closing brace.

- [ ] **Step 6: Run tests and commit**

Run selector, HTML parser, and row selection tests. Commit:

```powershell
git add src/core/pathTestRows.ts src/core/htmlReport.ts tests/core/pathTestRows.test.ts
git commit -m "feat: select path test workbook rows"
```

### Task 3: Generate the Separate Path-Test Workbook

**Files:**
- Modify: `tests/core/excelExporter.test.ts`
- Modify: `src/core/excelExporter.ts`
- Modify: `src/core/workbookTypes.ts`

- [ ] **Step 1: Write failing exporter tests**

Generate a normal workbook and a path-test workbook from one HTML report and C source pair. Read both with ExcelJS and assert:

```ts
expect(pathSheet.getCell("E1").value).toBeNull();
expect(pathSheet.getCell(markerRow, 5).value).toBe("■OK □NG");
expect(pathSheet.getColumn(1).width).toBe(normalSheet.getColumn(1).width);
expect(pathSheet.getCell("B2").style).toEqual(normalSheet.getCell("B2").style);
```

Also assert `.h`, comment-only C, and global-only C reports produce no source sheet, and zero targets produce the single `対象なし` sheet.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/core/excelExporter.test.ts
```

Expected: FAIL because no path-test output is produced.

- [ ] **Step 3: Refactor HTML parsing to one pass**

Change the exporter loop to:

```ts
const parsedRows = parseHtmlReport(await readFile(report.htmlPath, "utf8"), input.signal).rows;
writeNormalReportWorksheet(normalWorkbook, report, parsedRows, input);
await writePathTestWorksheet(pathWorkbook, report, parsedRows, input);
```

Keep the existing cell-style helper as the single implementation for A-D cells.

- [ ] **Step 4: Implement the second streaming workbook**

Add optional `pathTestOutputPath` and source paths to the input model. Write only selected source sheets. Leave E1 blank, put `■OK □NG` only on selected rows, and create `対象なし` only when no source sheet was written.

- [ ] **Step 5: Run exporter tests and commit**

Run exporter, HTML, and C-path tests. Commit:

```powershell
git add src/core/excelExporter.ts src/core/workbookTypes.ts tests/core/excelExporter.test.ts
git commit -m "feat: export path test workbook"
```

### Task 4: Integrate the Third Output Through Job, IPC, and GUI

**Files:**
- Modify: `tests/core/reportJob.test.ts`
- Modify: `tests/core/outputTransaction.test.ts`
- Modify: `tests/main/jobManager.test.ts`
- Modify: `tests/shared/jobMessages.test.ts`
- Modify: `tests/worker/workerProtocol.test.ts`
- Modify: `tests/renderer/uiText.test.ts`
- Modify: `src/core/reportJob.ts`
- Modify: `src/core/outputTransaction.ts`
- Modify: `src/shared/ipcTypes.ts`
- Modify: `src/shared/jobMessages.ts`
- Modify: `src/main/jobManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/uiText.ts`

- [ ] **Step 1: Write failing protocol and transaction tests**

Require `outputPathTestWorkbookPath` in job requests and summaries. Extend transaction tests to prove three staged outputs promote together and all three restore on a simulated second/third promotion failure.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/core/outputTransaction.test.ts tests/shared/jobMessages.test.ts tests/main/jobManager.test.ts
```

Expected: FAIL because the third output is absent from types and transaction behavior.

- [ ] **Step 3: Implement three-file orchestration**

Add `outputPathTestWorkbookPath` consistently to request, worker validation, summary, existence inspection, interrupted recovery, transaction staging, completion messages, and exporter input. Validate the three paths are distinct.

- [ ] **Step 4: Write failing UI text assertions**

Assert Japanese labels exist for:

```ts
UI_TEXT.fields.outputPathTestWorkbook
UI_TEXT.actions.choosePathTestWorkbook
```

and that the app description mentions the path-test Excel.

- [ ] **Step 5: Implement the GUI field and save dialog**

Add a third output field with a spreadsheet icon, a `path-test-report.xlsx` default name, run eligibility validation, request serialization, and completion log entry.

- [ ] **Step 6: Run integration tests and commit**

Run all changed protocol, worker, manager, job, transaction, and renderer tests. Commit:

```powershell
git add src tests
git commit -m "feat: integrate path test report output"
```

### Task 5: Samples, End-to-End Verification, and Visual Inspection

**Files:**
- Create: `local-samples/path-test-c-diff/before/src/path_cases.c`
- Create: `local-samples/path-test-c-diff/after/src/path_cases.c`
- Create: `local-samples/path-test-c-diff/before/include/only_header.h`
- Create: `local-samples/path-test-c-diff/after/include/only_header.h`
- Create: additional Git-ignored C fixtures for global, define, pragma, and comment-only exclusions.

- [ ] **Step 1: Create the Git-ignored sample**

Include every control-flow and exclusion case listed in the design. Keep function and line names explicit so generated marker positions can be audited manually.

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\electron-vite.cmd build
```

Expected: all tests pass and both compile/build commands exit 0.

- [ ] **Step 3: Generate real reports**

Run the core job against `local-samples/path-test-c-diff` with the installed `WinMergeU.exe`, producing normal Excel, Word, and path-test Excel under `local-samples/output/path-test-verification`.

- [ ] **Step 4: Inspect workbook values and formulas**

Use the bundled spreadsheet runtime to inspect all path-test sheets. Verify no formula errors, `E1` is blank, every source sheet has at least one later E marker, and excluded sample files do not appear.

- [ ] **Step 5: Render and visually inspect every path-test sheet**

Render bounded ranges for each sheet and confirm A-D formatting matches the normal diff workbook, text is legible, comments have blank E cells, and marker rows align with changed code/branches.

- [ ] **Step 6: Run requirement-by-requirement completion audit**

Check every item in the design’s completion conditions against current files, automated output, and generated workbook evidence. Fix any gap through a new RED-GREEN cycle.

- [ ] **Step 7: Commit final sample-independent changes**

Because `local-samples` is Git-ignored, commit only tracked production, test, and documentation changes:

```powershell
git add src tests docs
git commit -m "test: verify path test report workflow"
```
