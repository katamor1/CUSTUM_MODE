import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectChangedFiles, collectComparableFiles } from "../../src/core/filePairs";

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

describe("collectComparableFiles", () => {
  it("returns text file pairs by relative path and skips identical files", async () => {
    const left = await tempRoot("diffrepo-left-");
    const right = await tempRoot("diffrepo-right-");
    await write(left, "same.txt", "same");
    await write(right, "same.txt", "same");
    await write(left, "changed.txt", "left");
    await write(right, "changed.txt", "right");
    await write(left, "left-only.txt", "left only");
    await write(right, "right-only.txt", "right only");

    const pairs = await collectComparableFiles(left, right);

    expect(pairs.map((pair) => [pair.relativePath, pair.status])).toEqual([
      ["changed.txt", "modified"],
      ["left-only.txt", "deleted"],
      ["right-only.txt", "added"]
    ]);
  });

  it("skips binary files even when they differ", async () => {
    const left = await tempRoot("diffrepo-left-");
    const right = await tempRoot("diffrepo-right-");
    await write(left, "image.bin", Buffer.from([1, 2, 3, 0]));
    await write(right, "image.bin", Buffer.from([1, 2, 4, 0]));

    const pairs = await collectComparableFiles(left, right);

    expect(pairs).toEqual([]);
  });

  it("collects changed files including binary files for the Word change list", async () => {
    const left = await tempRoot("diffrepo-left-all-");
    const right = await tempRoot("diffrepo-right-all-");
    await write(left, "same.bin", Buffer.from([1, 2, 3, 0]));
    await write(right, "same.bin", Buffer.from([1, 2, 3, 0]));
    await write(left, "image.bin", Buffer.from([1, 2, 3, 0]));
    await write(right, "image.bin", Buffer.from([1, 2, 4, 0]));
    await write(left, "text.txt", "left");
    await write(right, "text.txt", "right");
    await write(left, "old.bin", Buffer.from([9, 8, 7, 0]));
    await write(right, "new.bin", Buffer.from([7, 8, 9, 0]));

    const files = await collectChangedFiles(left, right);

    expect(files.map((file) => ({ relativePath: file.relativePath, status: file.status, isText: file.isText }))).toEqual([
      { relativePath: "image.bin", status: "modified", isText: false },
      { relativePath: "new.bin", status: "added", isText: false },
      { relativePath: "old.bin", status: "deleted", isText: false },
      { relativePath: "text.txt", status: "modified", isText: true }
    ]);
  });
});
