import {
  access,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";

export interface OutputTransactionFileSystem {
  access: typeof access;
  rename: typeof rename;
  rm: typeof rm;
}

export interface TransactionOutputPaths {
  finalPath: string;
  stagePath: string;
  backupPath: string;
}

export interface OutputTransaction {
  workbook: TransactionOutputPaths;
  pathTestWorkbook: TransactionOutputPaths;
  document: TransactionOutputPaths;
  commit: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export interface CreateOutputTransactionInput {
  jobId: string;
  outputWorkbookPath: string;
  outputPathTestWorkbookPath: string;
  outputChangeListPath: string;
  fileSystem?: OutputTransactionFileSystem;
}

export interface RecoverInterruptedOutputTransactionInput
  extends Omit<CreateOutputTransactionInput, "fileSystem"> {
  existedBefore: {
    workbook: boolean;
    pathTestWorkbook: boolean;
    document: boolean;
  };
  fileSystem?: OutputTransactionFileSystem;
}

type TransactionState = "idle" | "committed" | "rolled-back" | "rollback-failed";

const DEFAULT_FILE_SYSTEM: OutputTransactionFileSystem = {
  access,
  rename,
  rm
};

export function createOutputTransaction(input: CreateOutputTransactionInput): OutputTransaction {
  const fileSystem = input.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const safeJobId = sanitizeJobId(input.jobId);
  const outputs = [
    makeOutputPaths(input.outputWorkbookPath, safeJobId),
    makeOutputPaths(input.outputPathTestWorkbookPath, safeJobId),
    makeOutputPaths(input.outputChangeListPath, safeJobId)
  ] as const;
  let state: TransactionState = "idle";

  return {
    workbook: outputs[0],
    pathTestWorkbook: outputs[1],
    document: outputs[2],
    commit: async () => {
      if (state !== "idle") {
        throw new Error(`Output transaction cannot commit from state: ${state}`);
      }

      await Promise.all(outputs.map((output) => fileSystem.access(output.stagePath)));
      await Promise.all(outputs.map((output) => removeIfPresent(fileSystem, output.backupPath)));

      const backedUp = new Set<string>();
      const promoted = new Set<string>();
      try {
        for (const output of outputs) {
          if (await pathExists(fileSystem, output.finalPath)) {
            await fileSystem.rename(output.finalPath, output.backupPath);
            backedUp.add(output.finalPath);
          }

          await fileSystem.rename(output.stagePath, output.finalPath);
          promoted.add(output.finalPath);
        }

        state = "committed";
        await Promise.allSettled(outputs.map((output) => removeIfPresent(fileSystem, output.backupPath)));
      } catch (commitError) {
        try {
          for (const output of [...outputs].reverse()) {
            if (promoted.has(output.finalPath)) {
              await removeIfPresent(fileSystem, output.finalPath);
            }
          }

          for (const output of [...outputs].reverse()) {
            if (backedUp.has(output.finalPath)) {
              await fileSystem.rename(output.backupPath, output.finalPath);
            }
          }
          state = "rolled-back";
        } catch (rollbackError) {
          state = "rollback-failed";
          throw new AggregateError(
            [commitError, rollbackError],
            "Output promotion failed and rollback could not restore all existing outputs"
          );
        }

        throw commitError;
      }
    },
    cleanup: async () => {
      await Promise.all(outputs.map((output) => removeIfPresent(fileSystem, output.stagePath)));
      if (state !== "rollback-failed") {
        await Promise.all(outputs.map((output) => removeIfPresent(fileSystem, output.backupPath)));
      }
    }
  };
}

export async function recoverInterruptedOutputTransaction(
  input: RecoverInterruptedOutputTransactionInput
): Promise<void> {
  const fileSystem = input.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const transaction = createOutputTransaction({
    jobId: input.jobId,
    outputWorkbookPath: input.outputWorkbookPath,
    outputPathTestWorkbookPath: input.outputPathTestWorkbookPath,
    outputChangeListPath: input.outputChangeListPath,
    fileSystem
  });
  const outputs = [
    { paths: transaction.workbook, existedBefore: input.existedBefore.workbook },
    {
      paths: transaction.pathTestWorkbook,
      existedBefore: input.existedBefore.pathTestWorkbook
    },
    { paths: transaction.document, existedBefore: input.existedBefore.document }
  ];

  for (const output of outputs) {
    if (await pathExists(fileSystem, output.paths.backupPath)) {
      await removeIfPresent(fileSystem, output.paths.finalPath);
      await fileSystem.rename(output.paths.backupPath, output.paths.finalPath);
    } else if (!output.existedBefore) {
      await removeIfPresent(fileSystem, output.paths.finalPath);
    }

    await removeIfPresent(fileSystem, output.paths.stagePath);
  }
}

function makeOutputPaths(finalPath: string, jobId: string): TransactionOutputPaths {
  const extension = path.extname(finalPath);
  const stem = path.basename(finalPath, extension);
  const directory = path.dirname(finalPath);
  return {
    finalPath,
    stagePath: path.join(directory, `${stem}.diffrepo-${jobId}.tmp${extension}`),
    backupPath: path.join(directory, `${stem}.diffrepo-${jobId}.bak${extension}`)
  };
}

function sanitizeJobId(jobId: string): string {
  const sanitized = jobId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "job";
}

async function pathExists(
  fileSystem: OutputTransactionFileSystem,
  candidatePath: string
): Promise<boolean> {
  try {
    await fileSystem.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfPresent(
  fileSystem: OutputTransactionFileSystem,
  candidatePath: string
): Promise<void> {
  await fileSystem.rm(candidatePath, { force: true });
}
