import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDiffWorkbook } from "../../src/core/reportJob";
import { createOutputTransaction } from "../../src/core/outputTransaction";
import type { HtmlReportFile } from "../../src/core/workbookTypes";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const tempRoots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function write(root: string, relativePath: string, content: Buffer | string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generateDiffWorkbook", () => {
  it("rejects duplicate output paths before starting external processes", async () => {
    const root = await tempRoot("diffrepo-job-duplicate-output-");
    const duplicatePath = join(root, "duplicate.xlsx");
    const runProcess = vi.fn(async () => undefined);

    await expect(generateDiffWorkbook({
      source: { kind: "folders", leftRoot: root, rightRoot: root },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: duplicatePath,
      outputPathTestWorkbookPath: duplicatePath,
      outputChangeListPath: join(root, "changes.docx"),
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: join(root, "work"),
      runProcess
    })).rejects.toThrow("出力先はそれぞれ別のファイル");

    expect(runProcess).not.toHaveBeenCalled();
  });

  it("aborts during WinMerge reporting and removes staged outputs and the work directory", async () => {
    const left = await tempRoot("diffrepo-job-abort-report-left-");
    const right = await tempRoot("diffrepo-job-abort-report-right-");
    const output = await tempRoot("diffrepo-job-abort-report-output-");
    const work = join(output, "work");
    const outputPath = join(output, "report.xlsx");
    const pathTestPath = join(output, "path-test.xlsx");
    const changeListPath = join(output, "changes.docx");
    const jobId = "abort-reporting";
    const transaction = createOutputTransaction({
      jobId,
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath
    });
    await write(left, "changed.txt", "before");
    await write(right, "changed.txt", "after");
    await writeFile(outputPath, "existing workbook");
    await writeFile(pathTestPath, "existing path test workbook");
    await writeFile(changeListPath, "existing document");
    const controller = new AbortController();

    await expect(generateDiffWorkbook({
      jobId,
      signal: controller.signal,
      source: { kind: "folders", leftRoot: left, rightRoot: right },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      runProcess: async (_executable, _args, signal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        signal?.throwIfAborted();
      }
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(await readFile(outputPath, "utf8")).toBe("existing workbook");
    expect(await readFile(pathTestPath, "utf8")).toBe("existing path test workbook");
    expect(await readFile(changeListPath, "utf8")).toBe("existing document");
    await expect(access(transaction.workbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.document.stagePath)).rejects.toThrow();
    await expect(access(work)).rejects.toThrow();
  });

  it("aborts during workbook export without exposing partial output", async () => {
    const left = await tempRoot("diffrepo-job-abort-workbook-left-");
    const right = await tempRoot("diffrepo-job-abort-workbook-right-");
    const output = await tempRoot("diffrepo-job-abort-workbook-output-");
    const work = join(output, "work");
    const outputPath = join(output, "report.xlsx");
    const pathTestPath = join(output, "path-test.xlsx");
    const changeListPath = join(output, "changes.docx");
    const jobId = "abort-workbook";
    const transaction = createOutputTransaction({
      jobId,
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath
    });
    await write(left, "changed.txt", "before");
    await write(right, "changed.txt", "after");
    await writeFile(outputPath, "existing workbook");
    await writeFile(pathTestPath, "existing path test workbook");
    await writeFile(changeListPath, "existing document");
    const controller = new AbortController();

    await expect(generateDiffWorkbook({
      jobId,
      signal: controller.signal,
      source: { kind: "folders", leftRoot: left, rightRoot: right },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      runProcess: async (_executable, args) => {
        await writeFile(args[args.indexOf("/or") + 1], "<pre>changed</pre>");
      },
      exportWorkbook: async (input) => {
        expect(input.outputPath).toBe(transaction.workbook.stagePath);
        expect(input.pathTestOutputPath).toBe(transaction.pathTestWorkbook.stagePath);
        await writeFile(input.outputPath, "partial workbook");
        await writeFile(input.pathTestOutputPath!, "partial path test workbook");
        controller.abort();
        input.signal?.throwIfAborted();
      }
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(await readFile(outputPath, "utf8")).toBe("existing workbook");
    expect(await readFile(pathTestPath, "utf8")).toBe("existing path test workbook");
    expect(await readFile(changeListPath, "utf8")).toBe("existing document");
    await expect(access(transaction.workbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.document.stagePath)).rejects.toThrow();
    await expect(access(work)).rejects.toThrow();
  });

  it("runs WinMerge per changed text file and merges reports into one workbook", async () => {
    const left = await tempRoot("diffrepo-job-left-");
    const right = await tempRoot("diffrepo-job-right-");
    const work = await tempRoot("diffrepo-job-work-");
    const outputPath = join(work, "merged.xlsx");
    const pathTestPath = join(work, "path-test.xlsx");
    const changeListPath = join(work, "changes.docx");
    await write(left, "ENG/Resource.rc", "left eng");
    await write(right, "ENG/Resource.rc", "right eng");
    await write(left, "JPN/Resource.rc", "deleted jpn");
    await write(right, "Readme.txt", "added readme");
    await write(left, "image.bin", Buffer.from([1, 2, 3, 0]));
    await write(right, "image.bin", Buffer.from([1, 2, 4, 0]));

    const calls: Array<{ executable: string; args: string[] }> = [];
    let workbookReports: HtmlReportFile[] = [];
    let workbookRowOutput: unknown;
    const rowOutput = {
      cFiles: { contextRows: 12, hideRetainedRows: false },
      otherTextFiles: { contextRows: 34, hideRetainedRows: true }
    };
    const summary = await generateDiffWorkbook({
      source: { kind: "folders", leftRoot: left, rightRoot: right },
      winMergePath: "C:/Tools/WinMerge/WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput,
      workDirectory: work,
      keepWorkDirectory: true,
      runProcess: async (executable, args) => {
        calls.push({ executable, args });
        const reportPath = args[args.indexOf("/or") + 1];
        await writeFile(reportPath, `<table><tr><th>Report</th><th>${basename(reportPath)}</th></tr></table>`);
      },
      exportWorkbook: async (input) => {
        workbookReports = input.reports;
        workbookRowOutput = input.rowOutput;
        await writeWorkbookWithSheets(input.outputPath, input.reports.map((report) => report.worksheetName));
        await writeWorkbookWithSheets(input.pathTestOutputPath!, ["対象なし"]);
      }
    });

    expect(summary.comparedFiles).toBe(3);
    expect(summary.outputPathTestWorkbookPath).toBe(pathTestPath);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.executable === "C:/Tools/WinMerge/WinMergeU.exe")).toBe(true);
    expect(calls.every((call) => call.args.includes("/noninteractive") && call.args.includes("/minimize"))).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Resource.rc_ENG", "Resource.rc_JPN", "Readme.txt"]);
    expect(workbookReports.map((report) => ({
      relativePath: report.relativePath,
      worksheetName: report.worksheetName,
      hasHtmlPath: report.htmlPath.endsWith(".html"),
      hasLeftOrRightPath: Boolean(report.leftPath || report.rightPath),
      hasInlineHtml: "html" in report
    }))).toEqual([
      { relativePath: "ENG/Resource.rc", worksheetName: "Resource.rc_ENG", hasHtmlPath: true, hasLeftOrRightPath: true, hasInlineHtml: false },
      { relativePath: "JPN/Resource.rc", worksheetName: "Resource.rc_JPN", hasHtmlPath: true, hasLeftOrRightPath: true, hasInlineHtml: false },
      { relativePath: "Readme.txt", worksheetName: "Readme.txt", hasHtmlPath: true, hasLeftOrRightPath: true, hasInlineHtml: false }
    ]);
    expect(workbookRowOutput).toEqual(rowOutput);
    expect(await docxText(changeListPath)).toContain("$/image.bin");
  }, 15000);

  it("generates WinMerge HTML reports concurrently while preserving workbook report order", async () => {
    const left = await tempRoot("diffrepo-job-concurrent-left-");
    const right = await tempRoot("diffrepo-job-concurrent-right-");
    const work = await tempRoot("diffrepo-job-concurrent-work-");
    const outputPath = join(work, "report.xlsx");
    const pathTestPath = join(work, "path-test.xlsx");
    const changeListPath = join(work, "changes.docx");
    await write(left, "a.txt", "left a");
    await write(right, "a.txt", "right a");
    await write(left, "b.txt", "left b");
    await write(right, "b.txt", "right b");
    await write(left, "c.txt", "left c");
    await write(right, "c.txt", "right c");

    let active = 0;
    let maxActive = 0;
    const completedReports: string[] = [];

    await generateDiffWorkbook({
      source: { kind: "folders", leftRoot: left, rightRoot: right },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      keepWorkDirectory: true,
      reportConcurrency: 2,
      runProcess: async (_executable, args) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const leftArg = args[args.indexOf("/or") - 2];
        const reportPath = args[args.indexOf("/or") + 1];
        await new Promise((resolve) => setTimeout(resolve, leftArg.endsWith("a.txt") ? 40 : 10));
        completedReports.push(reportPath);
        await writeFile(reportPath, "<pre>changed</pre>");
        active -= 1;
      },
      exportWorkbook: async (input) => {
        expect(input.reports.map((report) => report.relativePath)).toEqual(["a.txt", "b.txt", "c.txt"]);
        await writeWorkbookWithSheets(input.outputPath, input.reports.map((report) => report.worksheetName));
        await writeWorkbookWithSheets(input.pathTestOutputPath!, ["対象なし"]);
      }
    });

    expect(maxActive).toBe(2);
    expect(completedReports).toHaveLength(3);
  }, 15000);

  it("uses the file-based workbook exporter by default instead of invoking Excel COM", async () => {
    const left = await tempRoot("diffrepo-job-default-left-");
    const right = await tempRoot("diffrepo-job-default-right-");
    const work = await tempRoot("diffrepo-job-default-work-");
    const outputPath = join(work, "default.xlsx");
    const pathTestPath = join(work, "path-test.xlsx");
    const changeListPath = join(work, "default.docx");
    await write(left, "sample.c", "int value(void) { return 1; }\n");
    await write(right, "sample.c", "int value(void) { return 2; }\n");

    const calls: Array<{ executable: string; args: string[] }> = [];
    const progressMessages: string[] = [];
    await generateDiffWorkbook({
      source: {
        kind: "folders",
        leftRoot: relative(process.cwd(), left),
        rightRoot: relative(process.cwd(), right)
      },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      keepWorkDirectory: true,
      runProcess: async (executable, args) => {
        calls.push({ executable, args });
        expect(executable).toBe("WinMergeU.exe");
        const reportPath = args[args.indexOf("/or") + 1];
        await writeFile(reportPath, `
          <table>
            <tr><th colspan="2">${left}\\sample.c</th><th colspan="2">${right}\\sample.c</th></tr>
            <tr>
              <td>1</td><td style="background-color:#efcb05">int value(void) { return 1; }</td>
              <td>1</td><td style="background-color:#efcb05">int value(void) { return 2; }</td>
            </tr>
          </table>
        `);
      },
      onProgress: (progress) => progressMessages.push(progress.message)
    });

    const workbook = new ExcelJS.Workbook();
    const pathTestWorkbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    await pathTestWorkbook.xlsx.readFile(pathTestPath);

    expect(calls).toHaveLength(1);
    expect(progressMessages).toContain(`HTMLレポートをExcelブック化中: ${outputPath}`);
    expect(progressMessages.some((message) => message.startsWith("ExcelでHTMLレポートをブック化中"))).toBe(false);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["sample.c"]);
    expect(workbook.getWorksheet("sample.c")!.getCell("A1").value).toBe("【変更前】$/sample.c");
    expect(workbook.getWorksheet("sample.c")!.getCell("C1").value).toBe("【変更後】$/sample.c");
    expect(workbook.getWorksheet("sample.c")!.getCell("E1").value).toBe("■OK □NG");
    expect(pathTestWorkbook.getWorksheet("sample.c")!.getCell("E1").value).toBeNull();
  }, 15000);

  it("adds project-wide C specifications and analysis phases to the Word report", async () => {
    const left = await tempRoot("diffrepo-job-c-spec-left-");
    const right = await tempRoot("diffrepo-job-c-spec-right-");
    const work = await tempRoot("diffrepo-job-c-spec-work-");
    const outputPath = join(work, "c-spec.xlsx");
    const pathTestPath = join(work, "path-test.xlsx");
    const changeListPath = join(work, "c-spec.docx");
    await write(left, "src/module.c", "int existing(void) { return 1; }\n");
    await write(right, "src/module.c", `
/** @brief 新規処理
 * @param[in] value 入力値
 * @return 処理結果
 */
int added(int value) { return value; }
int existing(void) { return 1; }
struct Entry { int id; int (*handler)(int); };
int owner(void) {
  static const struct Entry table[] = {
    { 1, added }
  };
  return 0;
}
`);
    await write(left, "src/caller.c", "int caller(void) { return added(1); }\n");
    await write(right, "src/caller.c", "int caller(void) { return added(1); }\n");
    await write(right, "include/types.h", `
struct Item { int id; };
extern struct Item item; ///< 項目
`);

    const phases: string[] = [];
    await generateDiffWorkbook({
      source: { kind: "folders", leftRoot: left, rightRoot: right },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      keepWorkDirectory: true,
      runProcess: async (_executable, args) => {
        const reportPath = args[args.indexOf("/or") + 1];
        await writeFile(reportPath, "<pre>changed</pre>");
      },
      exportWorkbook: async (input) => {
        await writeWorkbookWithSheets(input.outputPath, input.reports.map((report) => report.worksheetName));
        await writeWorkbookWithSheets(input.pathTestOutputPath!, ["対象なし"]);
      },
      onProgress: (progress) => phases.push(progress.phase)
    });

    const paragraphs = await docxText(changeListPath);
    expect(paragraphs).toContain("added");
    expect(paragraphs).toContain("$/src/caller.c : caller");
    expect(paragraphs).toContain("$/src/module.c : owner");
    expect(paragraphs).toContain("item");
    expect(paragraphs).toContain("Item");
    expect(phases).toContain("analyzing-c");
    expect(phases).toContain("resolving-types");
    expect(phases).toContain("writing-document");
  }, 15000);

  it("exports Bazaar revisions before comparing folders", async () => {
    const repo = await tempRoot("diffrepo-bzr-repo-");
    const work = await tempRoot("diffrepo-bzr-work-");
    const outputPath = join(work, "bzr.xlsx");
    const pathTestPath = join(work, "path-test.xlsx");
    const changeListPath = join(work, "bzr.docx");
    const calls: Array<{ executable: string; args: string[] }> = [];

    await generateDiffWorkbook({
      source: {
        kind: "bazaar",
        repositoryPath: repo,
        leftRevision: "10",
        rightRevision: "11",
        bazaarPath: "brz"
      },
      winMergePath: "WinMergeU.exe",
      outputWorkbookPath: outputPath,
      outputPathTestWorkbookPath: pathTestPath,
      outputChangeListPath: changeListPath,
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory: work,
      keepWorkDirectory: true,
      runProcess: async (executable, args) => {
        calls.push({ executable, args });
        if (args[1] === "export") {
          const revision = args[3];
          const exportRoot = args[4];
          await write(exportRoot, "changed.txt", `revision ${revision}`);
          return;
        }

        const reportPath = args[args.indexOf("/or") + 1];
        await writeFile(reportPath, "<pre>changed</pre>");
      },
      exportWorkbook: async (input) => {
        await writeWorkbookWithSheets(input.outputPath, input.reports.map((report) => report.worksheetName));
        await writeWorkbookWithSheets(input.pathTestOutputPath!, ["対象なし"]);
      }
    });

    expect(calls.slice(0, 2)).toEqual([
      { executable: "brz", args: ["--no-aliases", "export", "-r", "10", join(work, "exports", "left"), repo] },
      { executable: "brz", args: ["--no-aliases", "export", "-r", "11", join(work, "exports", "right"), repo] }
    ]);
    expect(calls[2].executable).toBe("WinMergeU.exe");
    expect(await readFile(outputPath)).toBeInstanceOf(Buffer);
    expect(await readFile(pathTestPath)).toBeInstanceOf(Buffer);
    expect(await readFile(changeListPath)).toBeInstanceOf(Buffer);
  }, 15000);
});

async function writeWorkbookWithSheets(outputPath: string, sheetNames: string[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  for (const sheetName of sheetNames) {
    workbook.addWorksheet(sheetName);
  }
  await workbook.xlsx.writeFile(outputPath);
}

async function docxText(filePath: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  return Array.from(documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)).map((paragraphMatch) => {
    const paragraphXml = paragraphMatch[0].replace(/<w:tab\/>/g, "\t");
    return Array.from(paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((textMatch) => textMatch[1])
      .join("");
  });
}
