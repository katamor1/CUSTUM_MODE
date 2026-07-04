import type { StartJobRequest } from "../../shared/ipcTypes";
import type { AppSettings } from "../../shared/settings";
import { areOutputPathsDistinct } from "./outputPaths";

export type JobRequestMode = "folders" | "bazaar";

export interface JobRequestForm {
  mode: JobRequestMode;
  settings: AppSettings;
  leftFolder: string;
  rightFolder: string;
  repoPath: string;
  leftRevision: string;
  rightRevision: string;
  outputWorkbookPath: string;
  outputPathTestWorkbookPath: string;
  outputChangeListPath: string;
}

export function buildStartJobRequest(form: JobRequestForm): StartJobRequest | undefined {
  const winMergePath = form.settings.winMergePath.trim();
  const bazaarPath = form.settings.bazaarPath.trim();
  const outputWorkbookPath = form.outputWorkbookPath.trim();
  const outputPathTestWorkbookPath = form.outputPathTestWorkbookPath.trim();
  const outputChangeListPath = form.outputChangeListPath.trim();

  if (!winMergePath
    || !hasExtension(outputWorkbookPath, ".xlsx")
    || !hasExtension(outputPathTestWorkbookPath, ".xlsx")
    || !hasExtension(outputChangeListPath, ".docx")
    || !areOutputPathsDistinct([
      outputWorkbookPath,
      outputPathTestWorkbookPath,
      outputChangeListPath
    ])) {
    return undefined;
  }

  if (form.mode === "folders") {
    const leftRoot = form.leftFolder.trim();
    const rightRoot = form.rightFolder.trim();
    if (!leftRoot || !rightRoot) {
      return undefined;
    }
    return {
      winMergePath,
      outputWorkbookPath,
      outputPathTestWorkbookPath,
      outputChangeListPath,
      rowOutput: form.settings.rowOutput,
      source: { kind: "folders", leftRoot, rightRoot }
    };
  }

  const repositoryPath = form.repoPath.trim();
  const leftRevision = form.leftRevision.trim();
  const rightRevision = form.rightRevision.trim();
  if (!repositoryPath || !leftRevision || !rightRevision || !bazaarPath) {
    return undefined;
  }

  return {
    winMergePath,
    outputWorkbookPath,
    outputPathTestWorkbookPath,
    outputChangeListPath,
    rowOutput: form.settings.rowOutput,
    source: {
      kind: "bazaar",
      repositoryPath,
      leftRevision,
      rightRevision,
      bazaarPath
    }
  };
}

function hasExtension(filePath: string, extension: string): boolean {
  return filePath.trim().toLowerCase().endsWith(extension);
}
