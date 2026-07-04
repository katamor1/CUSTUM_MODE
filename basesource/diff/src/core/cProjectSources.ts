import { readdir } from "node:fs/promises";
import path from "node:path";
import type { CSourceInput } from "./cProjectModels";
import { readTextFile } from "./textDecoder";

export async function collectCSourceInputs(
  root: string,
  signal?: AbortSignal
): Promise<CSourceInput[]> {
  const paths: string[] = [];
  await collectPaths(root, root, paths, signal);
  paths.sort((left, right) => left.localeCompare(right, "en"));

  const inputs: CSourceInput[] = [];
  for (const relativePath of paths) {
    signal?.throwIfAborted();
    inputs.push({
      relativePath: `$/${relativePath}`,
      content: await readTextFile(path.join(root, ...relativePath.split("/")))
    });
  }
  return inputs;
}

async function collectPaths(
  root: string,
  current: string,
  paths: string[],
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    signal?.throwIfAborted();
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectPaths(root, fullPath, paths, signal);
      continue;
    }
    if (!entry.isFile() || !/\.(?:c|h)$/i.test(entry.name)) {
      continue;
    }
    paths.push(path.relative(root, fullPath).replaceAll(path.sep, "/"));
  }
}
