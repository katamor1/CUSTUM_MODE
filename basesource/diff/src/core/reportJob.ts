import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBazaarExportArgs } from "./bazaar";
import { type ChangeListFile, exportChangeListDocument } from "./changeListDocument";
import { extractChangedCFunctions } from "./cFunctionChanges";
import { buildProjectCSpecifications } from "./cSpecificationProject";
import { exportReportsWorkbookFromHtmlFiles } from "./excelExporter";
import { collectChangedFiles } from "./filePairs";
import { mapLimit } from "./limitedConcurrency";
import { createOutputTransaction } from "./outputTransaction";
import { makeUniqueWorksheetNames } from "./sheetNames";
import { readTextFile } from "./textDecoder";
import type { ChangedFileEntry } from "./types";
import { buildWinMergeReportArgs } from "./winmergeCommand";
import type { AppSettings } from "../shared/settings";
import type { ExportReportsWorkbookInput, HtmlReportFile } from "./workbookTypes";

export type DiffSource =
  | {
      kind: "folders";
      leftRoot: string;
      rightRoot: string;
    }
  | {
      kind: "bazaar";
      repositoryPath: string;
      leftRevision: string;
      rightRevision: string;
      bazaarPath: string;
    };

export interface ReportProgress {
  phase:
    | "exporting"
    | "scanning"
    | "reporting"
    | "workbook"
    | "path-test-workbook"
    | "analyzing-c"
    | "resolving-types"
    | "writing-document"
    | "cancelling"
    | "done";
  message: string;
  completed: number;
  total: number;
}

export type RunProcess = (executable: string, args: string[], signal?: AbortSignal) => Promise<void>;
export type ExportWorkbook = (input: ExportReportsWorkbookInput) => Promise<void>;

export interface GenerateDiffWorkbookInput {
  jobId?: string;
  signal?: AbortSignal;
  source: DiffSource;
  winMergePath: string;
  outputWorkbookPath: string;
  outputPathTestWorkbookPath: string;
  outputChangeListPath: string;
  rowOutput: AppSettings["rowOutput"];
  workDirectory?: string;
  keepWorkDirectory?: boolean;
  reportConcurrency?: number;
  runProcess: RunProcess;
  exportWorkbook?: ExportWorkbook;
  onProgress?: (progress: ReportProgress) => void;
}

export interface GenerateDiffWorkbookSummary {
  comparedFiles: number;
  changedFiles: number;
  outputWorkbookPath: string;
  outputPathTestWorkbookPath: string;
  outputChangeListPath: string;
  workDirectory: string;
}

export async function generateDiffWorkbook(input: GenerateDiffWorkbookInput): Promise<GenerateDiffWorkbookSummary> {
  input.signal?.throwIfAborted();
  assertDistinctOutputPaths([
    input.outputWorkbookPath,
    input.outputPathTestWorkbookPath,
    input.outputChangeListPath
  ]);
  const workDirectory = input.workDirectory ?? await mkdtemp(path.join(tmpdir(), "diffrepo-report-"));
  const transaction = createOutputTransaction({
    jobId: input.jobId ?? hashName(
      `${input.outputWorkbookPath}\0${input.outputPathTestWorkbookPath}\0${input.outputChangeListPath}`
    ),
    outputWorkbookPath: input.outputWorkbookPath,
    outputPathTestWorkbookPath: input.outputPathTestWorkbookPath,
    outputChangeListPath: input.outputChangeListPath
  });
  const shouldClean = input.keepWorkDirectory !== true
    && !isPathInside(input.outputWorkbookPath, workDirectory)
    && !isPathInside(input.outputPathTestWorkbookPath, workDirectory)
    && !isPathInside(input.outputChangeListPath, workDirectory);

  try {
    await mkdir(workDirectory, { recursive: true });
    const sourceRoots = await resolveSourceRoots(
      input.source,
      workDirectory,
      input.runProcess,
      input.signal,
      input.onProgress
    );

    input.signal?.throwIfAborted();
    input.onProgress?.({ phase: "scanning", message: "テキスト差分をスキャン中", completed: 0, total: 0 });
    const changedFiles = await collectChangedFiles(
      sourceRoots.leftRoot,
      sourceRoots.rightRoot,
      input.signal
    );
    const pairs = changedFiles.filter((file) => file.isText);
    const worksheetNames = makeUniqueWorksheetNames(pairs.map((pair) => pair.relativePath));
    const reportsDirectory = path.join(workDirectory, "reports");
    await mkdir(reportsDirectory, { recursive: true });
    const emptyFilePath = path.join(workDirectory, "empty-counterpart.txt");
    await writeFile(emptyFilePath, "");

    const reportSpecs = pairs.map((pair, index) => ({
      pair,
      reportPath: path.join(reportsDirectory, `${String(index + 1).padStart(4, "0")}-${hashName(pair.relativePath)}.html`),
      worksheetName: worksheetNames.get(pair.relativePath) ?? `Sheet${index + 1}`
    }));
    let completedReports = 0;
    const reports = await mapLimit(reportSpecs, input.reportConcurrency ?? defaultReportConcurrency(), async (spec) => {
      input.signal?.throwIfAborted();
      input.onProgress?.({
        phase: "reporting",
        message: `WinMergeレポート生成中: ${spec.pair.relativePath}`,
        completed: completedReports,
        total: pairs.length
      });
      await input.runProcess(
        input.winMergePath,
        buildWinMergeReportArgs(spec.pair.leftPath ?? emptyFilePath, spec.pair.rightPath ?? emptyFilePath, spec.reportPath),
        input.signal
      );
      completedReports += 1;
      input.onProgress?.({
        phase: "reporting",
        message: `WinMergeレポート生成完了: ${spec.pair.relativePath}`,
        completed: completedReports,
        total: pairs.length
      });
      return {
        relativePath: spec.pair.relativePath,
        worksheetName: spec.worksheetName,
        status: spec.pair.status,
        htmlPath: spec.reportPath,
        leftPath: spec.pair.leftPath,
        rightPath: spec.pair.rightPath
      };
    }, input.signal);

    input.signal?.throwIfAborted();
    input.onProgress?.({
      phase: "workbook",
      message: `HTMLレポートをExcelブック化中: ${input.outputWorkbookPath}`,
      completed: pairs.length,
      total: pairs.length
    });
    await (input.exportWorkbook ?? exportReportsWorkbookFromHtmlFiles)({
      outputPath: transaction.workbook.stagePath,
      pathTestOutputPath: transaction.pathTestWorkbook.stagePath,
      workDirectory,
      reports,
      pathReplacements: [
        { rootPath: sourceRoots.leftRoot, label: "【変更前】$" },
        { rootPath: sourceRoots.rightRoot, label: "【変更後】$" }
      ],
      rowOutput: input.rowOutput,
      signal: input.signal,
      onProgress: (completed, total, relativePath) => {
        input.onProgress?.({
          phase: "workbook",
          message: `Excelシートを書き込み中: ${relativePath}`,
          completed,
          total
        });
      }
    });

    input.signal?.throwIfAborted();
    input.onProgress?.({
      phase: "path-test-workbook",
      message: `パステストExcelを作成しました: ${input.outputPathTestWorkbookPath}`,
      completed: pairs.length,
      total: pairs.length
    });
    input.signal?.throwIfAborted();
    input.onProgress?.({
      phase: "analyzing-c",
      message: "C言語ファイルを解析中",
      completed: 0,
      total: 0
    });
    const specifications = await buildProjectCSpecifications({
      beforeRoot: sourceRoots.leftRoot,
      afterRoot: sourceRoots.rightRoot,
      signal: input.signal,
      onProgress: (completed, total, relativePath) => {
        input.onProgress?.({
          phase: "analyzing-c",
          message: relativePath
            ? `C言語ファイルを解析中: ${relativePath}`
            : "C言語ファイルを解析中",
          completed,
          total
        });
      },
      onResolvingTypes: () => {
        input.onProgress?.({
          phase: "resolving-types",
          message: "C言語の型サイズと呼び出し元を解決中",
          completed: 0,
          total: 0
        });
      }
    });

    input.signal?.throwIfAborted();
    input.onProgress?.({
      phase: "writing-document",
      message: `Wordレポートを書き込み中: ${input.outputChangeListPath}`,
      completed: pairs.length,
      total: pairs.length
    });
    await exportChangeListDocument({
      outputPath: transaction.document.stagePath,
      files: await buildChangeListFiles(changedFiles, input.signal),
      specifications,
      signal: input.signal
    });

    input.signal?.throwIfAborted();
    await transaction.commit();
    input.onProgress?.({
      phase: "done",
      message: `作成しました: ${input.outputWorkbookPath}, ${input.outputPathTestWorkbookPath}, ${input.outputChangeListPath}`,
      completed: pairs.length,
      total: pairs.length
    });
    return {
      comparedFiles: pairs.length,
      changedFiles: changedFiles.length,
      outputWorkbookPath: input.outputWorkbookPath,
      outputPathTestWorkbookPath: input.outputPathTestWorkbookPath,
      outputChangeListPath: input.outputChangeListPath,
      workDirectory
    };
  } finally {
    await transaction.cleanup();
    if (shouldClean) {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
}

async function buildChangeListFiles(
  files: ChangedFileEntry[],
  signal?: AbortSignal
): Promise<ChangeListFile[]> {
  const changeListFiles: ChangeListFile[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    changeListFiles.push({
      relativePath: file.relativePath,
      status: file.status,
      isText: file.isText,
      functions: file.isText
        ? extractChangedCFunctions(
            file.relativePath,
            file.status,
            file.leftPath ? await readTextFile(file.leftPath) : undefined,
            file.rightPath ? await readTextFile(file.rightPath) : undefined
          )
        : []
    });
  }

  return changeListFiles;
}

async function resolveSourceRoots(
  source: DiffSource,
  workDirectory: string,
  runProcess: RunProcess,
  signal?: AbortSignal,
  onProgress?: (progress: ReportProgress) => void
): Promise<{ leftRoot: string; rightRoot: string }> {
  if (source.kind === "folders") {
    return {
      leftRoot: path.resolve(source.leftRoot),
      rightRoot: path.resolve(source.rightRoot)
    };
  }

  const leftRoot = path.join(workDirectory, "exports", "left");
  const rightRoot = path.join(workDirectory, "exports", "right");
  await mkdir(path.dirname(leftRoot), { recursive: true });

  signal?.throwIfAborted();
  onProgress?.({ phase: "exporting", message: `Bazaarリビジョン${source.leftRevision}をエクスポート中`, completed: 0, total: 2 });
  await runProcess(
    source.bazaarPath,
    buildBazaarExportArgs(source.repositoryPath, source.leftRevision, leftRoot),
    signal
  );

  signal?.throwIfAborted();
  onProgress?.({ phase: "exporting", message: `Bazaarリビジョン${source.rightRevision}をエクスポート中`, completed: 1, total: 2 });
  await runProcess(
    source.bazaarPath,
    buildBazaarExportArgs(source.repositoryPath, source.rightRevision, rightRoot),
    signal
  );

  return { leftRoot, rightRoot };
}

function hashName(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function defaultReportConcurrency(): number {
  return 2;
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertDistinctOutputPaths(outputPaths: string[]): void {
  const normalized = outputPaths.map((outputPath) => path.resolve(outputPath).toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("出力先はそれぞれ別のファイルを指定してください。");
  }
}
