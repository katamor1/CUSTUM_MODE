# Parameter Settings and Row Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent report parameters, write only selected/retained rows to Excel, and remove obsolete Excel COM and non-streaming export paths.

**Architecture:** Keep settings validation and normalization in a shared pure module, classify HTML report rows before ExcelJS writes them, and expose only the file-based streaming workbook API. The renderer edits a draft in a modal and persists it only on Save.

**Tech Stack:** TypeScript, React 18, Electron IPC, ExcelJS streaming writer, Vitest

---

### Task 1: Shared Settings Model

**Files:**
- Create: `src/shared/settings.ts`
- Modify: `src/shared/ipcTypes.ts`
- Test: `tests/shared/settings.test.ts`

- [ ] **Step 1: Write failing normalization and validation tests**

```ts
expect(normalizeAppSettings({ winMergePath: "x" })).toEqual({
  winMergePath: "x",
  bazaarPath: "brz",
  lastOutputDirectory: "",
  rowOutput: {
    cFiles: { contextRows: 100, hideRetainedRows: true },
    otherTextFiles: { contextRows: 100, hideRetainedRows: true }
  }
});
expect(validateRowOutputPolicy({ contextRows: -1, hideRetainedRows: true })).toBe(false);
```

- [ ] **Step 2: Run `npm test -- tests/shared/settings.test.ts` and verify failure**
- [ ] **Step 3: Implement `DEFAULT_APP_SETTINGS`, deep normalization, and integer validation**
- [ ] **Step 4: Run the focused test and verify pass**
- [ ] **Step 5: Commit `feat: add report parameter settings model`**

### Task 2: Settings Persistence and Job Snapshot

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/shared/ipcTypes.ts`
- Modify: `src/core/reportJob.ts`
- Test: `tests/core/reportJob.test.ts`
- Test: `tests/main/settings.test.ts`

- [ ] **Step 1: Write failing tests for legacy settings deep merge and row policy propagation**

```ts
expect(normalizeAppSettings({ rowOutput: { cFiles: { contextRows: 12 } } }))
  .toMatchObject({
    rowOutput: {
      cFiles: { contextRows: 12, hideRetainedRows: true },
      otherTextFiles: { contextRows: 100, hideRetainedRows: true }
    }
  });
expect(exportInput.rowOutput).toEqual(request.rowOutput);
```

- [ ] **Step 2: Verify tests fail because nested defaults and job policy do not exist**
- [ ] **Step 3: Normalize on load/save and add `rowOutput` to `StartJobRequest` and workbook input**
- [ ] **Step 4: Verify focused tests pass**
- [ ] **Step 5: Commit `feat: propagate row output settings`**

### Task 3: Pure Report Row Selection

**Files:**
- Create: `src/core/reportRowSelection.ts`
- Test: `tests/core/reportRowSelection.test.ts`

- [ ] **Step 1: Write failing tests for visible, retained, and omitted rows**

```ts
const result = selectReportRows("include/sample.h", rows, {
  contextRows: 1,
  hideRetainedRows: true
});
expect(result.map((row) => [row.sourceRowNumber, row.visibility])).toEqual([
  [1, "structure"],
  [4, "retained"],
  [5, "visible"],
  [6, "visible"],
  [7, "visible"],
  [8, "retained"]
]);
```

Cover:
- structure rows always retained and visible;
- header/other-text blank-line plus N behavior;
- C source changed function fully visible;
- unchanged functions omitted unless in the outer retained N range;
- N=0;
- overlapping ranges;
- retained rows crossing function boundaries;
- added/deleted rows.

- [ ] **Step 2: Verify the tests fail because the module is absent**
- [ ] **Step 3: Implement extraction of code rows, C function ranges, inner visible range, outer retained range, and stable original row numbers**
- [ ] **Step 4: Verify focused tests pass**
- [ ] **Step 5: Commit `feat: classify report rows before export`**

### Task 4: Streaming Workbook Uses Selection

**Files:**
- Create: `src/core/workbookTypes.ts`
- Modify: `src/core/excelExporter.ts`
- Modify: `tests/core/excelExporter.test.ts`

- [ ] **Step 1: Convert one exporter test to temporary HTML file input and assert omitted rows do not exist**

```ts
await exportReportsWorkbookFromHtmlFiles({
  outputPath,
  workDirectory: root,
  reports: [{ relativePath: "sample.txt", worksheetName: "sample.txt", status: "modified", htmlPath }],
  rowOutput: {
    cFiles: { contextRows: 1, hideRetainedRows: true },
    otherTextFiles: { contextRows: 1, hideRetainedRows: true }
  }
});
expect(sheet.getColumn(1).values).not.toContain(200);
```

- [ ] **Step 2: Verify failure because all report rows are currently written**
- [ ] **Step 3: Filter rows before column-width calculation and `worksheet.addRow`; hide only `retained` rows when configured**
- [ ] **Step 4: Migrate all Excel tests to the file-based streaming API and verify colors, rich text, paths, missing counterpart labels, widths, and E1 marker**
- [ ] **Step 5: Commit `feat: stream only selected report rows`**

### Task 5: Remove Obsolete Exporters

**Files:**
- Delete: `src/core/excelComExporter.ts`
- Delete: `tests/core/excelComExporter.test.ts`
- Delete: `src/core/cRowVisibility.ts`
- Modify: `src/core/excelExporter.ts`
- Modify: `src/core/reportJob.ts`
- Modify: `tests/core/processRunner.test.ts`

- [ ] **Step 1: Add a source scan assertion or focused typecheck expectation that production imports do not reference obsolete modules**
- [ ] **Step 2: Verify the assertion fails**
- [ ] **Step 3: Move shared types to `workbookTypes.ts`, remove `exportReportsWorkbook`, delete COM and old visibility modules, and rename PowerShell-specific process-output test wording**
- [ ] **Step 4: Run `rg -n "excelComExporter|exportReportsWorkbookWithExcel|computeHiddenCReportRows|CONTEXT_ROWS_AFTER_UNCHANGED_BLANK" src tests` and expect no matches**
- [ ] **Step 5: Run `npm test` and `npm run build`**
- [ ] **Step 6: Commit `refactor: remove obsolete workbook paths`**

### Task 6: Settings Dialog

**Files:**
- Create: `src/renderer/src/settingsValidation.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/uiText.ts`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/renderer/settingsValidation.test.ts`
- Test: `tests/renderer/uiText.test.ts`

- [ ] **Step 1: Write failing tests for non-negative integer text validation and Japanese labels**
- [ ] **Step 2: Verify focused tests fail**
- [ ] **Step 3: Add a top-right Settings icon button and modal draft with C/other policies and WinMerge/Bazaar paths**
- [ ] **Step 4: Implement Save, Cancel, close, executable browse, validation messages, and move executable fields out of the main form**
- [ ] **Step 5: Run renderer tests and `npm run build`**
- [ ] **Step 6: Commit `feat: add report parameter dialog`**

