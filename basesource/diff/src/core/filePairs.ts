import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isTextBuffer } from "./fileClassifier";
import type { ChangedFileEntry, ComparableFilePair } from "./types";

const SAMPLE_SIZE = 8192;

export async function collectComparableFiles(
  leftRoot: string,
  rightRoot: string,
  signal?: AbortSignal
): Promise<ComparableFilePair[]> {
  return (await collectChangedFiles(leftRoot, rightRoot, signal))
    .filter((file) => file.isText)
    .map(({ isText: _isText, ...pair }) => pair);
}

export async function collectChangedFiles(
  leftRoot: string,
  rightRoot: string,
  signal?: AbortSignal
): Promise<ChangedFileEntry[]> {
  signal?.throwIfAborted();
  const [leftFiles, rightFiles] = await Promise.all([
    listFiles(leftRoot, signal),
    listFiles(rightRoot, signal)
  ]);
  const allRelativePaths = Array.from(new Set([...leftFiles.keys(), ...rightFiles.keys()])).sort((a, b) =>
    a.localeCompare(b, "en")
  );

  const files: ChangedFileEntry[] = [];
  for (const relativePath of allRelativePaths) {
    signal?.throwIfAborted();
    const leftPath = leftFiles.get(relativePath);
    const rightPath = rightFiles.get(relativePath);

    if (leftPath && rightPath) {
      const [leftIsText, rightIsText] = await Promise.all([isTextFile(leftPath), isTextFile(rightPath)]);
      if (await filesHaveSameContent(leftPath, rightPath)) {
        continue;
      }

      files.push({ relativePath, leftPath, rightPath, status: "modified", isText: leftIsText && rightIsText });
      continue;
    }

    if (leftPath) {
      files.push({ relativePath, leftPath, status: "deleted", isText: await isTextFile(leftPath) });
      continue;
    }

    if (rightPath) {
      files.push({ relativePath, rightPath, status: "added", isText: await isTextFile(rightPath) });
    }
  }

  return files;
}

async function listFiles(root: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  await visit(root, root, files, signal);
  return files;
}

async function visit(
  root: string,
  current: string,
  files: Map<string, string>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    signal?.throwIfAborted();
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await visit(root, fullPath, files, signal);
      continue;
    }

    if (entry.isFile()) {
      const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
      files.set(relativePath, fullPath);
    }
  }
}

async function isTextFile(filePath: string): Promise<boolean> {
  const buffer = await readFile(filePath);
  return isTextBuffer(buffer.subarray(0, SAMPLE_SIZE));
}

async function filesHaveSameContent(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([stat(leftPath), stat(rightPath)]);
  if (leftStat.size !== rightStat.size) {
    return false;
  }

  const [leftHash, rightHash] = await Promise.all([hashFile(leftPath), hashFile(rightPath)]);
  return leftHash === rightHash;
}

async function hashFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}
