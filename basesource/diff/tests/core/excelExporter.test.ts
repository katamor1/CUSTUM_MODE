import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { exportReportsWorkbookFromHtmlFiles } from "../../src/core/excelExporter";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../src/shared/settings";
import type { FilePairStatus } from "../../src/core/types";

const tempRoots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exportReportsWorkbookFromHtmlFiles", () => {
  it("writes a separate path-test workbook from the same styled HTML rows", async () => {
    const root = await tempRoot("diffrepo-xlsx-path-test-");
    const reportsDirectory = join(root, "reports");
    const normalWorkbookPath = join(root, "diff-report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test-report.xlsx");
    const htmlPath = join(reportsDirectory, "sample.html");
    const beforePath = join(root, "before", "src", "sample.c");
    const afterPath = join(root, "after", "src", "sample.c");
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    // old explanation",
      "    int total = value + 1;",
      "    if (total > 10) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}",
      "",
      "int comment_only(void)",
      "{",
      "    // old comment",
      "    return 1;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    // new explanation",
      "    int total = value + 2;",
      "    if (total > 20) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}",
      "",
      "int comment_only(void)",
      "{",
      "    // new comment",
      "    return 1;",
      "}"
    ].join("\n");
    await mkdir(reportsDirectory, { recursive: true });
    await mkdir(join(root, "before", "src"), { recursive: true });
    await mkdir(join(root, "after", "src"), { recursive: true });
    await writeFile(beforePath, beforeSource);
    await writeFile(afterPath, afterSource);
    await writeFile(htmlPath, cDiffHtml(
      beforeSource.split("\n").map((left, index) => ({
        left,
        right: afterSource.split("\n")[index],
        diff: [3, 4, 5, 13].includes(index + 1)
      }))
    ));

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: normalWorkbookPath,
      pathTestOutputPath: pathTestWorkbookPath,
      workDirectory: root,
      reports: [{
        relativePath: "src/sample.c",
        worksheetName: "sample.c",
        status: "modified",
        htmlPath,
        leftPath: beforePath,
        rightPath: afterPath
      }],
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput
    });

    const normalWorkbook = new ExcelJS.Workbook();
    const pathTestWorkbook = new ExcelJS.Workbook();
    await normalWorkbook.xlsx.readFile(normalWorkbookPath);
    await pathTestWorkbook.xlsx.readFile(pathTestWorkbookPath);
    const normalSheet = normalWorkbook.getWorksheet("sample.c")!;
    const pathSheet = pathTestWorkbook.getWorksheet("sample.c")!;

    expect(pathTestWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(["sample.c"]);
    expect(pathSheet.getCell("E1").value).toBeNull();
    expect(pathSheet.rowCount).toBe(10);
    expect(sourceLineValues(pathSheet)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(rowForAfterSourceLine(pathSheet, "4")?.getCell(5).value).toBe("■OK □NG");
    expect(rowForAfterSourceLine(pathSheet, "5")?.getCell(5).value).toBe("■OK □NG");
    expect(rowForAfterSourceLine(pathSheet, "3")?.getCell(5).value).toBeNull();
    expect(sourceLineValues(pathSheet)).not.toContain("13");
    expect(pathSheet.getColumn(1).width).toBe(normalSheet.getColumn(1).width);
    expect(pathSheet.getColumn(2).width).toBe(normalSheet.getColumn(2).width);
    expect(pathSheet.getColumn(3).width).toBe(normalSheet.getColumn(3).width);
    expect(pathSheet.getColumn(4).width).toBe(normalSheet.getColumn(4).width);
    expect(patternArgb(rowForAfterSourceLine(pathSheet, "4")?.getCell(4).fill))
      .toBe(patternArgb(rowForAfterSourceLine(normalSheet, "4")?.getCell(4).fill));
  });

  it("does not add path-test review markers to colored rows whose C line fact is unchanged", async () => {
    const root = await tempRoot("diffrepo-xlsx-path-test-reasons-");
    const reportsDirectory = join(root, "reports");
    const normalWorkbookPath = join(root, "diff-report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test-report.xlsx");
    const htmlPath = join(reportsDirectory, "sample.html");
    const beforePath = join(root, "before", "src", "sample.c");
    const afterPath = join(root, "after", "src", "sample.c");
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 1;",
      "    if (total > 10) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 2;",
      "    if (total > 20) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}"
    ].join("\n");
    await mkdir(reportsDirectory, { recursive: true });
    await mkdir(join(root, "before", "src"), { recursive: true });
    await mkdir(join(root, "after", "src"), { recursive: true });
    await writeFile(beforePath, beforeSource);
    await writeFile(afterPath, afterSource);
    await writeFile(htmlPath, cDiffHtml(
      beforeSource.split("\n").map((left, index) => ({
        left,
        right: afterSource.split("\n")[index],
        diff: [3, 4, 5].includes(index + 1)
      }))
    ));

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: normalWorkbookPath,
      pathTestOutputPath: pathTestWorkbookPath,
      workDirectory: root,
      reports: [{
        relativePath: "src/sample.c",
        worksheetName: "sample.c",
        status: "modified",
        htmlPath,
        leftPath: beforePath,
        rightPath: afterPath
      }],
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput
    });

    const pathTestWorkbook = new ExcelJS.Workbook();
    await pathTestWorkbook.xlsx.readFile(pathTestWorkbookPath);
    const pathSheet = pathTestWorkbook.getWorksheet("sample.c")!;

    expect(rowForAfterSourceLine(pathSheet, "3")?.getCell(5).value).toBe("■OK □NG");
    expect(rowForAfterSourceLine(pathSheet, "4")?.getCell(5).value).toBe("■OK □NG");
    expect(rowForAfterSourceLine(pathSheet, "5")?.getCell(5).value).toBeNull();
  });

  it("writes only the no-target sheet when headers and non-function C changes are provided", async () => {
    const root = await tempRoot("diffrepo-xlsx-path-test-empty-");
    const normalWorkbookPath = join(root, "diff-report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test-report.xlsx");
    const reportsDirectory = join(root, "reports");
    await mkdir(reportsDirectory, { recursive: true });

    const reports = [];
    for (const [index, fixture] of [
      {
        relativePath: "include/only_header.h",
        before: "#define VALUE 1",
        after: "#define VALUE 2"
      },
      {
        relativePath: "src/global_only.c",
        before: "#define LIMIT 1\n#pragma pack(push, 1)\nint global_value = 1;",
        after: "#define LIMIT 2\n#pragma pack(push, 2)\nint global_value = 2;"
      },
      {
        relativePath: "src/comment_only.c",
        before: "int kept(void)\n{\n    // before\n    return 1;\n}",
        after: "int kept(void)\n{\n    // after\n    return 1;\n}"
      }
    ].entries()) {
      const htmlPath = join(reportsDirectory, `${index}.html`);
      const leftPath = join(root, "before", fixture.relativePath);
      const rightPath = join(root, "after", fixture.relativePath);
      await mkdir(join(leftPath, ".."), { recursive: true });
      await mkdir(join(rightPath, ".."), { recursive: true });
      await writeFile(leftPath, fixture.before);
      await writeFile(rightPath, fixture.after);
      await writeFile(htmlPath, cDiffHtml(
        fixture.before.split("\n").map((left, lineIndex) => ({
          left,
          right: fixture.after.split("\n")[lineIndex] ?? "",
          diff: true
        }))
      ));
      reports.push({
        relativePath: fixture.relativePath,
        worksheetName: `excluded-${index}`,
        status: "modified" as const,
        htmlPath,
        leftPath,
        rightPath
      });
    }

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: normalWorkbookPath,
      pathTestOutputPath: pathTestWorkbookPath,
      workDirectory: root,
      reports,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput
    });

    const pathTestWorkbook = new ExcelJS.Workbook();
    await pathTestWorkbook.xlsx.readFile(pathTestWorkbookPath);

    expect(pathTestWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(["対象なし"]);
    expect(pathTestWorkbook.getWorksheet("対象なし")?.getCell("A1").value)
      .toBe("パステスト対象となる変更はありません。");
  });

  it("does not rewrite source text just because it contains a source-root prefix", async () => {
    const root = await tempRoot("diffrepo-xlsx-path-boundary-");
    const workbookPath = join(root, "diff-report.xlsx");
    const htmlPath = join(root, "report.html");
    await writeFile(htmlPath, `
      <table>
        <tr><th>1</th><td style="background-color:#ffff00">C:/repo/leftover/file.txt</td><th>1</th><td>unchanged</td></tr>
      </table>
    `);

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: workbookPath,
      workDirectory: root,
      reports: [{
        relativePath: "sample.txt",
        worksheetName: "sample.txt",
        status: "modified",
        htmlPath
      }],
      pathReplacements: [{ rootPath: "C:/repo/left", label: "【変更前】$" }],
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    expect(workbook.getWorksheet("sample.txt")!.getCell("B1").value).toBe("C:/repo/leftover/file.txt");
  });

  it("streams WinMerge HTML files into one workbook without requiring inline HTML payloads", async () => {
    const root = await tempRoot("diffrepo-xlsx-html-files-");
    const reportsDirectory = join(root, "reports");
    const workbookPath = join(root, "from-files.xlsx");
    const htmlPath = join(reportsDirectory, "resource.html");
    await mkdir(reportsDirectory, { recursive: true });
    await writeFile(htmlPath, `
      <table>
        <tr>
          <th colspan="2">C:\\repo\\left\\ENG\\Resource.rc</th>
          <th colspan="2">C:\\repo\\right\\ENG\\Resource.rc</th>
        </tr>
        <tr>
          <td>1</td><td style="background-color:#ffdddd">IDS_MESSAGE "before"</td>
          <td>1</td><td style="background-color:#ddffdd">IDS_MESSAGE "after"</td>
        </tr>
      </table>
    `);

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: workbookPath,
      workDirectory: root,
      reports: [
        {
          relativePath: "ENG/Resource.rc",
          worksheetName: "Resource.rc_ENG",
          status: "modified",
          htmlPath
        }
      ],
      pathReplacements: [
        { rootPath: "C:\\repo\\left", label: "【変更前】$" },
        { rootPath: "C:\\repo\\right", label: "【変更後】$" }
      ],
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("Resource.rc_ENG")!;

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["Resource.rc_ENG"]);
    expect(sheet.getCell("A1").value).toBe("【変更前】$/ENG/Resource.rc");
    expect(sheet.getCell("C1").value).toBe("【変更後】$/ENG/Resource.rc");
    expect(sheet.getCell("E1").value).toBe("■OK □NG");
    expect(sheet.getCell("B2").value).toBe('IDS_MESSAGE "before"');
    expect(sheet.getCell("D2").value).toBe('IDS_MESSAGE "after"');
  });

  it("does not write report rows outside the selected range", async () => {
    const root = await tempRoot("diffrepo-xlsx-selected-rows-");
    const workbookPath = join(root, "selected.xlsx");
    const htmlPath = join(root, "selected.html");
    await writeFile(htmlPath, `
      <table>
        <tr><th colspan="2">left.txt</th><th colspan="2">right.txt</th></tr>
        <tr>
          <td>198</td><td style="background-color:#ffffff">far unchanged</td>
          <td>198</td><td style="background-color:#ffffff">far unchanged</td>
        </tr>
        <tr>
          <td>199</td><td style="background-color:#ffffff">retained unchanged</td>
          <td>199</td><td style="background-color:#ffffff">retained unchanged</td>
        </tr>
        <tr>
          <td>200</td><td style="background-color:#ffffff">visible context</td>
          <td>200</td><td style="background-color:#ffffff">visible context</td>
        </tr>
        <tr>
          <td>201</td><td style="background-color:#ffffff"></td>
          <td>201</td><td style="background-color:#ffffff"></td>
        </tr>
        <tr>
          <td>202</td><td style="background-color:#ffdddd">before</td>
          <td>202</td><td style="background-color:#ddffdd">after</td>
        </tr>
      </table>
    `);

    await exportReportsWorkbookFromHtmlFiles({
      outputPath: workbookPath,
      workDirectory: root,
      reports: [{ relativePath: "sample.txt", worksheetName: "sample.txt", status: "modified", htmlPath }],
      rowOutput: {
        cFiles: { contextRows: 0, hideRetainedRows: true },
        otherTextFiles: { contextRows: 1, hideRetainedRows: false }
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("sample.txt")!;

    expect(sheet.getColumn(1).values).not.toContain("198");
    expect(sheet.getColumn(1).values).toContain("199");
    expect(sheet.getColumn(1).values).toContain("202");
    expect(rowForSourceLine(sheet, "199")!.hidden).toBeFalsy();
  });

  it("writes one worksheet per report with metadata and parsed rows", async () => {
    const root = await tempRoot("diffrepo-xlsx-");
    const workbookPath = join(root, "report.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "ENG/Resource.rc",
          worksheetName: "Resource.rc_ENG",
          status: "modified",
          html: "<table><tr><th>Line</th><th>Left</th><th>Right</th></tr><tr><td>1</td><td style=\"background-color:#ffdddd\">A</td><td>B</td></tr></table>"
        },
        {
          relativePath: "JPN/Resource.rc",
          worksheetName: "Resource.rc_JPN",
          status: "added",
          html: "<pre>added text</pre>"
        }
      ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Resource.rc_ENG", "Resource.rc_JPN"]);
    const firstSheet = workbook.getWorksheet("Resource.rc_ENG")!;
    expect(firstSheet.getCell("A1").value).toBe("Line");
    expect(firstSheet.getCell("B2").value).toBe("A");
    expect(firstSheet.getCell("C2").value).toBe("B");
  });

  it("copies HTML report cell colors and line-number alignment into Excel", async () => {
    const root = await tempRoot("diffrepo-xlsx-style-");
    const workbookPath = join(root, "styled.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "ENG/Resource.rc",
          worksheetName: "Resource.rc",
          status: "modified",
          html: `
            <html>
              <head>
                <style>
                  .line { background-color: #eeeeee; text-align: right; }
                  .diffchange { background-color: #ffdddd; color: #9c0006; font-weight: bold; }
                </style>
              </head>
              <body>
                <table>
                  <tr><th class="line">Line</th><th>Left</th><th>Right</th></tr>
                  <tr><td class="line">7</td><td class="diffchange">old</td><td style="background-color:#ddffdd;color:#006100">new</td></tr>
                </table>
              </body>
            </html>
          `
        }
      ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("Resource.rc")!;

    expect(sheet.getCell("A2").alignment?.horizontal).toBe("right");
    expect(patternArgb(sheet.getCell("A2").fill)).toBe("FFEEEEEE");
    expect(patternArgb(sheet.getCell("B2").fill)).toBe("FFFFDDDD");
    expect(sheet.getCell("B2").font?.color?.argb).toBe("FF9C0006");
    expect(sheet.getCell("B2").font?.bold).toBe(true);
    expect(patternArgb(sheet.getCell("C2").fill)).toBe("FFDDFFDD");
    expect(sheet.getCell("C2").font?.color?.argb).toBe("FF006100");
  });

  it("does not add metadata rows and preserves colspan-based WinMerge alignment", async () => {
    const root = await tempRoot("diffrepo-xlsx-colspan-");
    const workbookPath = join(root, "colspan.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "ENG/Resource.rc",
          worksheetName: "Resource.rc",
          status: "modified",
          html: `
            <table>
              <tr>
                <th colspan="2">left-file</th>
                <th colspan="2">right-file</th>
              </tr>
              <tr>
                <td>1</td><td style="background-color:#ffdddd">left line</td>
                <td>1</td><td style="background-color:#ddffdd">right line</td>
              </tr>
            </table>
          `
        }
      ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("Resource.rc")!;

    expect(sheet.getCell("A1").value).toBe("left-file");
    expect(sheet.getCell("C1").value).toBe("right-file");
    expect(sheet.getCell("A2").value).toBe("1");
    expect(sheet.getCell("B2").value).toBe("left line");
    expect(sheet.getCell("C2").value).toBe("1");
    expect(sheet.getCell("D2").value).toBe("right line");
    expect(sheet.getCell("A3").value).toBeNull();
  });

  it("rewrites header paths, keeps line-number columns narrow, adds review marker, and uses a monospace font", async () => {
    const root = await tempRoot("diffrepo-xlsx-layout-");
    const workbookPath = join(root, "layout.xlsx");
    const beforeRoot = "C:\\Users\\stell\\source\\repos\\diffRepo\\local-samples\\folder-diff\\left";
    const afterRoot = "C:\\Users\\stell\\source\\repos\\diffRepo\\local-samples\\folder-diff\\right";

    await exportHtmlReports(root, workbookPath, [
      {
        relativePath: "ENG/Resource.rc",
        worksheetName: "Resource.rc",
        status: "modified",
        html: `
          <table>
            <tr>
              <th colspan="2">${beforeRoot}\\ENG\\Resource.rc</th>
              <th colspan="2">${afterRoot}\\ENG\\Resource.rc</th>
            </tr>
            <tr>
              <td>1</td><td>IDS_TITLE "Sample Application"</td>
              <td>1</td><td>IDS_TITLE "Sample Application"</td>
            </tr>
            <tr>
              <td>123</td><td style="background-color:#ffdddd">IDS_MESSAGE "Hello from before"</td>
              <td>123</td><td style="background-color:#ddffdd">IDS_MESSAGE "Hello from after"</td>
            </tr>
          </table>
        `
      }
    ], {
      pathReplacements: [
        { rootPath: beforeRoot, label: "【変更前】$" },
        { rootPath: afterRoot, label: "【変更後】$" }
      ]
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("Resource.rc")!;

    expect(sheet.getCell("A1").value).toBe("【変更前】$/ENG/Resource.rc");
    expect(sheet.getCell("C1").value).toBe("【変更後】$/ENG/Resource.rc");
    expect(sheet.getCell("E1").value).toBe("■OK □NG");
    expect(sheet.getColumn(1).width).toBeLessThanOrEqual(6);
    expect(sheet.getColumn(3).width).toBeLessThanOrEqual(6);
    expect(sheet.getCell("A1").font?.name).toBe("MS Gothic");
    expect(sheet.getCell("B2").font?.name).toBe("MS Gothic");
    expect(sheet.getCell("E1").font?.name).toBe("MS Gothic");
  });

  it("exports nested WinMerge syntax spans as Excel rich text", async () => {
    const root = await tempRoot("diffrepo-xlsx-richtext-");
    const workbookPath = join(root, "richtext.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "src/example.c",
          worksheetName: "example.c",
          status: "modified",
          html: `
            <html>
              <head>
                <style>
                  .code { color: #1f2937; }
                  .kw { color: #0000ff; font-weight: bold; }
                  .str { color: #a31515; }
                  .inlineDiff { color: #9c0006; font-weight: bold; background-color: #ffeb9c; }
                </style>
              </head>
              <body>
                <table>
                  <tr>
                    <td class="code"><span class="kw">if</span> (name == <span class="str">"old"</span><span class="inlineDiff">Value</span>)</td>
                  </tr>
                </table>
              </body>
            </html>
          `
        }
      ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const value = workbook.getWorksheet("example.c")!.getCell("A1").value as ExcelJS.CellRichTextValue;

    expect(value.richText.map((run) => ({
      text: run.text,
      fontName: run.font?.name,
      color: run.font?.color?.argb,
      bold: run.font?.bold
    }))).toEqual([
      { text: "if", fontName: "MS Gothic", color: "FF0000FF", bold: true },
      { text: " (name == ", fontName: "MS Gothic", color: "FF1F2937", bold: undefined },
      { text: '"old"', fontName: "MS Gothic", color: "FFA31515", bold: undefined },
      { text: "Value", fontName: "MS Gothic", color: "FF9C0006", bold: true },
      { text: ")", fontName: "MS Gothic", color: "FF1F2937", bold: undefined }
    ]);
  });

  it("labels empty counterparts for added and deleted files and mirrors the existing-side content width", async () => {
    const root = await tempRoot("diffrepo-xlsx-empty-counterpart-");
    const workbookPath = join(root, "empty-counterpart.xlsx");
    const beforeRoot = "C:\\Users\\stell\\source\\repos\\diffRepo\\local-samples\\folder-diff\\left";
    const afterRoot = "C:\\Users\\stell\\source\\repos\\diffRepo\\local-samples\\folder-diff\\right";
    const emptyCounterpart = `${root}\\empty-counterpart.txt`;

    await exportHtmlReports(root, workbookPath, [
      {
        relativePath: "RightOnly/added.txt",
        worksheetName: "added.txt",
        status: "added",
        html: `
          <table>
            <tr>
              <th colspan="2">${emptyCounterpart}</th>
              <th colspan="2">${afterRoot}\\RightOnly\\added.txt</th>
            </tr>
            <tr>
              <td></td><td style="background-color:#ffdddd"></td>
              <td>1</td><td style="background-color:#ddffdd">const added_value = "added file content";</td>
            </tr>
          </table>
        `
      },
      {
        relativePath: "LeftOnly/deleted.txt",
        worksheetName: "deleted.txt",
        status: "deleted",
        html: `
          <table>
            <tr>
              <th colspan="2">${beforeRoot}\\LeftOnly\\deleted.txt</th>
              <th colspan="2">${emptyCounterpart}</th>
            </tr>
            <tr>
              <td>1</td><td style="background-color:#ffdddd">const deleted_value = "deleted file content";</td>
              <td></td><td style="background-color:#ddffdd"></td>
            </tr>
          </table>
        `
      }
    ], {
      pathReplacements: [
        { rootPath: beforeRoot, label: "【変更前】$" },
        { rootPath: afterRoot, label: "【変更後】$" }
      ]
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const addedSheet = workbook.getWorksheet("added.txt")!;
    const deletedSheet = workbook.getWorksheet("deleted.txt")!;

    expect(addedSheet.getCell("A1").value).toBe("【変更前】ファイルなし");
    expect(addedSheet.getCell("C1").value).toBe("【変更後】$/RightOnly/added.txt");
    expect(addedSheet.getColumn(2).width).toBe(addedSheet.getColumn(4).width);

    expect(deletedSheet.getCell("A1").value).toBe("【変更前】$/LeftOnly/deleted.txt");
    expect(deletedSheet.getCell("C1").value).toBe("【変更後】ファイルなし");
    expect(deletedSheet.getColumn(4).width).toBe(deletedSheet.getColumn(2).width);
  });

  it("hides unchanged C header rows outside blank-line context around diff rows", async () => {
    const root = await tempRoot("diffrepo-xlsx-c-header-");
    const workbookPath = join(root, "c-header.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "include/sample_config.h",
          worksheetName: "sample_config.h",
          status: "modified",
          html: cDiffHtml([
            { left: "#define FAR_BEFORE_1 1", right: "#define FAR_BEFORE_1 1" },
            { left: "#define FAR_BEFORE_2 2", right: "#define FAR_BEFORE_2 2" },
            { left: "#define CONTEXT_BEFORE_3 3", right: "#define CONTEXT_BEFORE_3 3" },
            { left: "#define CONTEXT_BEFORE_2 4", right: "#define CONTEXT_BEFORE_2 4" },
            { left: "#define CONTEXT_BEFORE_1 5", right: "#define CONTEXT_BEFORE_1 5" },
            { left: "", right: "" },
            { left: "#define NEAR_BEFORE 6", right: "#define NEAR_BEFORE 6" },
            { left: "#define TARGET_VALUE 10", right: "#define TARGET_VALUE 20", diff: true },
            { left: "#define NEAR_AFTER 7", right: "#define NEAR_AFTER 7" },
            { left: "", right: "" },
            { left: "#define CONTEXT_AFTER_1 8", right: "#define CONTEXT_AFTER_1 8" },
            { left: "#define CONTEXT_AFTER_2 9", right: "#define CONTEXT_AFTER_2 9" },
            { left: "#define CONTEXT_AFTER_3 10", right: "#define CONTEXT_AFTER_3 10" },
            { left: "#define FAR_AFTER_1 11", right: "#define FAR_AFTER_1 11" },
            { left: "#define FAR_AFTER_2 12", right: "#define FAR_AFTER_2 12" }
          ])
        }
      ], {
      rowOutput: {
        cFiles: { contextRows: 1, hideRetainedRows: true },
        otherTextFiles: DEFAULT_APP_SETTINGS.rowOutput.otherTextFiles
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("sample_config.h")!;

    expect(sourceLineValues(sheet)).toEqual(["4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(rowForSourceLine(sheet, "4")!.hidden).toBe(true);
    expect(rowForSourceLine(sheet, "5")!.hidden).toBeFalsy();
    expect(rowForSourceLine(sheet, "12")!.hidden).toBe(true);
  });

  it("hides unchanged C source functions and shows full functions that contain diff rows", async () => {
    const root = await tempRoot("diffrepo-xlsx-c-source-");
    const workbookPath = join(root, "c-source.xlsx");

    await exportHtmlReports(root, workbookPath, [
        {
          relativePath: "src/sample_module.c",
          worksheetName: "sample_module.c",
          status: "modified",
          html: cDiffHtml([
            { left: "#include \"sample_module.h\"", right: "#include \"sample_module.h\"" },
            { left: "", right: "" },
            { left: "static int global_limit = 10;", right: "static int global_limit = 20;", diff: true },
            { left: "", right: "" },
            { left: "static int global_context_1 = 1;", right: "static int global_context_1 = 1;" },
            { left: "static int global_context_2 = 2;", right: "static int global_context_2 = 2;" },
            { left: "static int global_context_3 = 3;", right: "static int global_context_3 = 3;" },
            { left: "static int global_far_after = 4;", right: "static int global_far_after = 4;" },
            { left: "", right: "" },
            { left: "static int unchanged_helper(int value)", right: "static int unchanged_helper(int value)" },
            { left: "{", right: "{" },
            { left: "    int total = value;", right: "    int total = value;" },
            { left: "    total += 1;", right: "    total += 1;" },
            { left: "    return total;", right: "    return total;" },
            { left: "}", right: "}" },
            { left: "", right: "" },
            { left: "int changed_function(int value)", right: "int changed_function(int value)" },
            { left: "{", right: "{" },
            { left: "    int total = value;", right: "    int total = value;" },
            { left: "    total += 10;", right: "    total += 20;", diff: true },
            { left: "    return total;", right: "    return total;" },
            { left: "}", right: "}" },
            { left: "", right: "" },
            { left: "int trailing_far_global = 5;", right: "int trailing_far_global = 5;" }
          ])
        }
      ], {
      rowOutput: {
        cFiles: { contextRows: 2, hideRetainedRows: true },
        otherTextFiles: DEFAULT_APP_SETTINGS.rowOutput.otherTextFiles
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheet = workbook.getWorksheet("sample_module.c")!;

    expect(sourceLineValues(sheet)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8",
      "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"
    ]);
    expect(rowForSourceLine(sheet, "10")).toBeUndefined();
    expect(rowForSourceLine(sheet, "15")!.hidden).toBe(true);
    expect(rowForSourceLine(sheet, "17")!.hidden).toBeFalsy();
    expect(rowForSourceLine(sheet, "20")!.hidden).toBeFalsy();
    expect(rowForSourceLine(sheet, "24")!.hidden).toBe(true);
  });
});

function patternArgb(fill: ExcelJS.Fill | undefined): string | undefined {
  return fill && fill.type === "pattern" ? fill.fgColor?.argb : undefined;
}

interface HtmlTestReport {
  relativePath: string;
  worksheetName: string;
  status: FilePairStatus;
  html: string;
}

interface ExportHtmlOptions {
  pathReplacements?: Array<{ rootPath: string; label: string }>;
  rowOutput?: AppSettings["rowOutput"];
}

async function exportHtmlReports(
  root: string,
  outputPath: string,
  reports: HtmlTestReport[],
  options: ExportHtmlOptions = {}
): Promise<void> {
  const reportsDirectory = join(root, "reports");
  await mkdir(reportsDirectory, { recursive: true });
  const fileReports = [];

  for (const [index, report] of reports.entries()) {
    const htmlPath = join(reportsDirectory, `${index + 1}.html`);
    await writeFile(htmlPath, report.html);
    fileReports.push({
      relativePath: report.relativePath,
      worksheetName: report.worksheetName,
      status: report.status,
      htmlPath
    });
  }

  await exportReportsWorkbookFromHtmlFiles({
    outputPath,
    workDirectory: root,
    reports: fileReports,
    pathReplacements: options.pathReplacements,
    rowOutput: options.rowOutput ?? DEFAULT_APP_SETTINGS.rowOutput
  });
}

function sourceLineValues(sheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  sheet.eachRow((row) => {
    const value = row.getCell(1).value;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      values.push(value);
    }
  });
  return values;
}

function rowForSourceLine(sheet: ExcelJS.Worksheet, sourceLine: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === sourceLine) {
      found = row;
    }
  });
  return found;
}

function rowForAfterSourceLine(sheet: ExcelJS.Worksheet, sourceLine: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (row.getCell(3).value === sourceLine) {
      found = row;
    }
  });
  return found;
}

function cDiffHtml(rows: Array<{ left: string; right: string; diff?: boolean }>): string {
  return `
    <table>
      <tr>
        <th colspan="2">left.c</th>
        <th colspan="2">right.c</th>
      </tr>
      ${rows.map((row, index) => {
        const codeStyle = row.diff ? "background-color:#efcb05;color:#000000" : "background-color:#ffffff;color:#000000";
        return `
          <tr>
            <td class="ln" style="background-color:#f0f0f0;text-align:right">${index + 1}</td>
            <td style="${codeStyle}">${escapeHtml(row.left)}</td>
            <td class="ln" style="background-color:#f0f0f0;text-align:right">${index + 1}</td>
            <td style="${codeStyle}">${escapeHtml(row.right)}</td>
          </tr>
        `;
      }).join("")}
    </table>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
