import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readTextFile(path: string): Promise<string> {
  return readFile(resolveReadPath(path), "utf8");
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const text = await readTextFile(path);
  return JSON.parse(text) as T;
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveReadPath(path: string): string {
  if (existsSync(path)) {
    return path;
  }

  const repoRoot = findRepositoryRoot(process.cwd());
  const repoRelative = join(repoRoot, path);
  if (existsSync(repoRelative)) {
    return repoRelative;
  }

  return path;
}

function findRepositoryRoot(start: string): string {
  let current = start;

  for (let index = 0; index < 10; index++) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "docs/workflows/code-consistency-review"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }

  return start;
}
