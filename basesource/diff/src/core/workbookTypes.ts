import type { AppSettings } from "../shared/settings";
import type { FilePairStatus } from "./types";

export interface HtmlReportFile {
  relativePath: string;
  worksheetName: string;
  status: FilePairStatus;
  htmlPath: string;
  leftPath?: string;
  rightPath?: string;
}

export interface PathReplacement {
  rootPath: string;
  label: string;
}

export interface ExportReportsWorkbookInput {
  outputPath: string;
  pathTestOutputPath?: string;
  workDirectory: string;
  reports: HtmlReportFile[];
  pathReplacements?: PathReplacement[];
  rowOutput: AppSettings["rowOutput"];
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, relativePath: string) => void;
}
