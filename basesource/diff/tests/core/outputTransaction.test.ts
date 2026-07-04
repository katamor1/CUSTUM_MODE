import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOutputTransaction,
  recoverInterruptedOutputTransaction,
  type OutputTransactionFileSystem
} from "../../src/core/outputTransaction";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createOutputTransaction", () => {
  it("creates same-directory job-specific stage and backup paths", async () => {
    const root = await tempRoot();
    const transaction = createOutputTransaction({
      jobId: "job:42",
      outputWorkbookPath: join(root, "diff-report.xlsx"),
      outputPathTestWorkbookPath: join(root, "path-test-report.xlsx"),
      outputChangeListPath: join(root, "diff-change-list.docx")
    });

    expect(transaction.workbook.stagePath).toBe(join(root, "diff-report.diffrepo-job-42.tmp.xlsx"));
    expect(transaction.pathTestWorkbook.stagePath).toBe(join(root, "path-test-report.diffrepo-job-42.tmp.xlsx"));
    expect(transaction.document.stagePath).toBe(join(root, "diff-change-list.diffrepo-job-42.tmp.docx"));
    expect(transaction.workbook.backupPath).toBe(join(root, "diff-report.diffrepo-job-42.bak.xlsx"));
    expect(transaction.pathTestWorkbook.backupPath).toBe(join(root, "path-test-report.diffrepo-job-42.bak.xlsx"));
    expect(transaction.document.backupPath).toBe(join(root, "diff-change-list.diffrepo-job-42.bak.docx"));
  });

  it("promotes both staged outputs and removes backups", async () => {
    const root = await tempRoot();
    const workbookPath = join(root, "report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test.xlsx");
    const documentPath = join(root, "changes.docx");
    const transaction = createOutputTransaction({
      jobId: "job-1",
      outputWorkbookPath: workbookPath,
      outputPathTestWorkbookPath: pathTestWorkbookPath,
      outputChangeListPath: documentPath
    });
    await writeFile(workbookPath, "old workbook");
    await writeFile(pathTestWorkbookPath, "old path test workbook");
    await writeFile(documentPath, "old document");
    await writeFile(transaction.workbook.stagePath, "new workbook");
    await writeFile(transaction.pathTestWorkbook.stagePath, "new path test workbook");
    await writeFile(transaction.document.stagePath, "new document");

    await transaction.commit();

    expect(await readFile(workbookPath, "utf8")).toBe("new workbook");
    expect(await readFile(pathTestWorkbookPath, "utf8")).toBe("new path test workbook");
    expect(await readFile(documentPath, "utf8")).toBe("new document");
    await expect(access(transaction.workbook.backupPath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.backupPath)).rejects.toThrow();
    await expect(access(transaction.document.backupPath)).rejects.toThrow();
  });

  it("restores both existing outputs when second-file promotion fails", async () => {
    const root = await tempRoot();
    const workbookPath = join(root, "report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test.xlsx");
    const documentPath = join(root, "changes.docx");
    let documentPromotionFailed = false;
    const fileSystem: OutputTransactionFileSystem = {
      access,
      rm,
      rename: async (sourcePath, targetPath) => {
        if (!documentPromotionFailed
          && String(sourcePath).endsWith(".tmp.docx")
          && targetPath === documentPath) {
          documentPromotionFailed = true;
          throw new Error("simulated document promotion failure");
        }
        await rename(sourcePath, targetPath);
      }
    };
    const transaction = createOutputTransaction({
      jobId: "job-2",
      outputWorkbookPath: workbookPath,
      outputPathTestWorkbookPath: pathTestWorkbookPath,
      outputChangeListPath: documentPath,
      fileSystem
    });
    await writeFile(workbookPath, "old workbook");
    await writeFile(pathTestWorkbookPath, "old path test workbook");
    await writeFile(documentPath, "old document");
    await writeFile(transaction.workbook.stagePath, "new workbook");
    await writeFile(transaction.pathTestWorkbook.stagePath, "new path test workbook");
    await writeFile(transaction.document.stagePath, "new document");

    await expect(transaction.commit()).rejects.toThrow("simulated document promotion failure");

    expect(await readFile(workbookPath, "utf8")).toBe("old workbook");
    expect(await readFile(pathTestWorkbookPath, "utf8")).toBe("old path test workbook");
    expect(await readFile(documentPath, "utf8")).toBe("old document");
    await transaction.cleanup();
    await expect(access(transaction.workbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.document.stagePath)).rejects.toThrow();
    await expect(access(transaction.workbook.backupPath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.backupPath)).rejects.toThrow();
    await expect(access(transaction.document.backupPath)).rejects.toThrow();
  });

  it("cleans staged files idempotently without deleting final outputs", async () => {
    const root = await tempRoot();
    const workbookPath = join(root, "report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test.xlsx");
    const documentPath = join(root, "changes.docx");
    const transaction = createOutputTransaction({
      jobId: "job-3",
      outputWorkbookPath: workbookPath,
      outputPathTestWorkbookPath: pathTestWorkbookPath,
      outputChangeListPath: documentPath
    });
    await writeFile(workbookPath, "old workbook");
    await writeFile(pathTestWorkbookPath, "old path test workbook");
    await writeFile(documentPath, "old document");
    await writeFile(transaction.workbook.stagePath, "partial workbook");
    await writeFile(transaction.pathTestWorkbook.stagePath, "partial path test workbook");
    await writeFile(transaction.document.stagePath, "partial document");

    await transaction.cleanup();
    await transaction.cleanup();

    expect(await readFile(workbookPath, "utf8")).toBe("old workbook");
    expect(await readFile(pathTestWorkbookPath, "utf8")).toBe("old path test workbook");
    expect(await readFile(documentPath, "utf8")).toBe("old document");
    await expect(access(transaction.workbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.pathTestWorkbook.stagePath)).rejects.toThrow();
    await expect(access(transaction.document.stagePath)).rejects.toThrow();
  });

  it("restores pre-existing outputs and removes newly promoted outputs after interruption", async () => {
    const root = await tempRoot();
    const workbookPath = join(root, "report.xlsx");
    const pathTestWorkbookPath = join(root, "path-test.xlsx");
    const documentPath = join(root, "changes.docx");
    const transaction = createOutputTransaction({
      jobId: "job-4",
      outputWorkbookPath: workbookPath,
      outputPathTestWorkbookPath: pathTestWorkbookPath,
      outputChangeListPath: documentPath
    });
    await writeFile(transaction.workbook.backupPath, "old workbook");
    await writeFile(workbookPath, "new workbook");
    await writeFile(transaction.pathTestWorkbook.backupPath, "old path test workbook");
    await writeFile(pathTestWorkbookPath, "new path test workbook");
    await writeFile(documentPath, "new document");
    await writeFile(transaction.document.stagePath, "partial document");

    await recoverInterruptedOutputTransaction({
      jobId: "job-4",
      outputWorkbookPath: workbookPath,
      outputPathTestWorkbookPath: pathTestWorkbookPath,
      outputChangeListPath: documentPath,
      existedBefore: {
        workbook: true,
        pathTestWorkbook: true,
        document: false
      }
    });

    expect(await readFile(workbookPath, "utf8")).toBe("old workbook");
    expect(await readFile(pathTestWorkbookPath, "utf8")).toBe("old path test workbook");
    await expect(access(documentPath)).rejects.toThrow();
    await expect(access(transaction.document.stagePath)).rejects.toThrow();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "diffrepo-output-transaction-"));
  tempRoots.push(root);
  return root;
}
